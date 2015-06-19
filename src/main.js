'use strict';

var Q = require('q'),
    util = require('util'),
    qhttp = require("q-io/http"),
    jwt = require('jsonwebtoken'),
    uuidGen = require('node-uuid')

Q.longStackSupport = true

function HttpError(statusCode, msgCode, details) {
    Error.captureStackTrace(this, this.constructor)

    this.status = statusCode
    this.msgCode = msgCode
    this.details = details || {}

    this.name = this.constructor.name
    this.message = [
        "Returning HTTP status ",
        statusCode,
        " because ",
        msgCode,
        ": ",
        JSON.stringify(details)
    ].join('')
}    
util.inherits(HttpError, Error)

var jwtVerifyQ = Q.nbind(jwt.verify, jwt);

var self = {
    uuidRe: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
     assertVector: function(v) {
        if (v === undefined || v === null || isNaN(v.x) || isNaN(v.y) || isNaN(v.z) || Object.keys(v).length !== 3)
            throw new Error("invalid vector: " + JSON.stringify(v))

        return v
    },
    assertUUID: function(value) {
        if (typeof value !== 'string' || !self.uuidRe.test(value))
            throw new Error("invalid uuid "+value)
    },
    logging: require('./logging'),
    http: {
        Error: HttpError,
        errHandler: function(req, res) {
            return function(err) {
                if (err.stack === undefined) {
                    var fakeErr = new Error();
                    Error.captureStackTrace(fakeErr, self.http.errHandler);
                    err.stack = fakeErr.stack
                }

                req.ctx.error({ err: err }, 'http request server error')

                if (self.isA(err, "HttpError")) {
                    res.status(err.status).send({
                        errorCode: err.msgCode,
                        errorDetails: err.details
                    })
                } else {
                    res.status(500).send(err.toString())
                }
            }
        },
        cors_policy: function(app) {
            var cors = require('cors')({
                credentials: true,
                origin: function(origin, cb) {
                    cb(null, true)
                }
            })

            app.use(cors)
            app.options("*", cors)
        },
        authorize_req: function (req, restricted) {
            var auth_header = req.headers.authorization

            if (auth_header === undefined) {
                // We do this so that the Q-promise error handling
                // will catch it
                return Q.fcall(function() {
                    throw new Error("not authorized missing header")
                })
            }

            var parts = auth_header.split(' ')
            if (parts[0] != "Bearer") {
                return Q.fcall(function() {
                    throw new Error("not authorized missing bearer")
                })
            }

            return self.http.authorize_token(parts[1], restricted).
            tap(function(auth) {
                req.ctx.trace({ auth: auth }, 'authorization')
            })
        },
        authorize_token: function(token, restricted) {
            return jwtVerifyQ(token, process.env.JWT_VERIFY_KEY).then(function(authorization) {
                if ((restricted === true || restricted == 'true') &&
                    authorization.privileged !== true) {
                    throw new Error("rejected for restricted endpoint: "+authorization.account)
                }

                return authorization
            })
        }
    },

    calc_poly: function(obj, values) {
        return obj.components.reduce(function(acc1, component) {
            var v1 = acc1 + component.reduce(function(acc2, exp, i) {
                var name = obj.parameters[i-1]
                var base = values[name]
                if (isNaN(base))
                    throw new Error("failed to get "+i+"/"+name+' from '+JSON.stringify(values))

                var pow = Math.pow(base, exp)

                var v2  = (acc2 * pow)

                //console.log(acc2, '*', base, '^', exp, '==', v2)
                return v2
            })

            //console.log(component, '+=', v1)
            return v1
        }, 0)
    },

    array_unique: function(a) {
        return a.filter(function(e, p) {
            return (a.indexOf(e) == p)
        
        })
    },

    compute_array_changes: function(original, current) {
        /*
         * This is based on what the module refitting differ needs
         * > C.compute_array_changes([1,2,3,4,4,4,], [2,3,4])
         *   { added: [],
         *     removed: [ 1, 4, 4 ],
         *     unchanged: [ 2, 3 ] }
         */
        function which_removed(a1, a2) {
            var copy = a2.slice(),
                removed = []

            // if we have any facilities for which we no longer
            // have modules installed, disable them for resolution
            a1.forEach(function(v) {
                var i = copy.indexOf(v)
                if (i > -1) {
                    copy.splice(i, 1)
                } else {
                    removed = removed.concat(v)
                }
            })

            return removed
        }

        function which_unchanged(original, removed) {
            return original.filter(function(v) {
                return (removed.indexOf(v) === -1)
            })
        }

        var changes = {
            added: which_removed(current, original),
            removed: which_removed(original, current)
        }

        changes.unchanged = which_unchanged(original, changes.removed)

        return changes
    },
    isA: function(o, c) {
        return (o.constructor.name == c)
    },
    find: function(hash, cmp, or_fail) {
        if (or_fail ===undefined)
            or_fail = true 

        for (var key in hash) {
            if (hash.hasOwnProperty(key)) {
                var value = hash[key]

                if (typeof cmp === 'function') {
                    if (cmp(key,value))
                        return value
                } else {
                    var matches = true

                    for (var Ckey in cmp) {
                        if (!value.hasOwnProperty(Ckey) || value[Ckey] !== cmp[Ckey])
                            matches = false
                    }

                    if (matches === true)
                        return value
                }
            
            }
        }

        if (or_fail)
            throw new Error("find failed"+JSON.stringify(cmp))
    },
    deepMerge: require('./deepMerge.js')
}

module.exports = self
