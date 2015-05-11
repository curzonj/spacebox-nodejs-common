'use strict';

var Q = require('q'),
    util = require('util'),
    qhttp = require("q-io/http"),
    debug = require('debug'),
    uuidGen = require('node-uuid')

Q.longStackSupport = true

var _endpointCache
var _authCache

var config = {}

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

var self = {
    http: {
        Error: HttpError,
        errHandler: function(req, res, log) {
            return function(err) {
                if (self.isA(err, "HttpError")) {
                    res.status(err.status).send({
                        errorCode: err.msgCode,
                        errorDetails: err.details
                    })
                } else {
                    if (err.stack === undefined) {
                        log(err)
                    } else {
                        log(err.stack)
                    }

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

            return self.http.authorize_token(parts[1], restricted)
        },
        authorize_token: function(token, restricted) {
            var request_id = uuidGen.v1()
            debug('c:request')('validating token', token, 'with request', request_id)

            // This will fail if it's not authorized
            return qhttp.read({
                charset: "UTF-8", // This gets aronud a q-io bug with browserify
                method: "POST",
                url: config.AUTH_URL + '/token',
                headers: {
                    'X-Request-ID': request_id,
                    "Content-Type": "application/json",
                },
                body: [JSON.stringify({
                    token: token,
                    restricted: (restricted === true)
                })]
            }).then(function(body) {
                return JSON.parse(body.toString())
            }).fail(function(e) {
                console.log(e.stack)
                throw new Error("not authorized")
            })
        },
    },

    qCatchOnly: function(c, fn) {
        return function(e) {
            if (self.isA(e, c)) {
                return fn(e)
            } else {
                throw e
            }
        }
    },
    isA: function(o, c) {
        return (o.constructor.name == c)
    },
    configure: function(h) {
        self.deepMerge(h, config)
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

        if (or_fail) {
            console.log(cmp)
            throw "find failed"
        }
    },
     deepMerge: function (src, tgt) {
        for (var attrname in src) {
            var v = src[attrname]

            if (typeof v == "object" &&
                tgt.hasOwnProperty(attrname) &&
                (typeof(tgt[attrname])) == "object") {

                self.deepMerge(v, tgt[attrname])
            } else if (v !== undefined){
                tgt[attrname] = v
            }
        }

        return tgt
    },
    request: function (endpoint, method, expects, path, body, opts) {
        if (opts === undefined) {
            opts = {}
        }

        return Q.spread([self.getEndpoints(), self.getAuthToken()], function(endpoints, token) {
            var bearer = token

            if (opts.sudo_account !== undefined) {
                bearer += '/' + opts.sudo_account
            }

            debug('c:request')({ endpoint: endpoint, method: method, path: path, expects: expects })
            return qhttp.request({
                charset: "UTF-8", // This gets aronud a q-io bug with browserify
                method: method,
                url: endpoints[endpoint] + path,
                headers: {
                    'X-Request-ID': uuidGen.v1(),
                    "Authorization": "Bearer " + bearer,
                    "Content-Type": "application/json"
                },
                body: ( (body === undefined || method == "GET") ? [] : [JSON.stringify(body)])
            }).then(function(resp) {
                if (resp.status !== expects) {
                    return resp.body.read().then(function(b) {
                        debug('c:request')(endpoint+" " + resp.status + " reason: " + b.toString())

                        var code, details

                        try {
                            var body = JSON.parse(b.toString())
                            details = body.errorDetails
                            code = body.errorCode
                        } catch(e) {
                            details = b.toString()
                            code = 'unknown'
                        }

                        throw new self.http.Error(resp.status, code, details)
                    })
                } else {
                    if (resp.status !== 204) {
                        return resp.body.read().then(function(b) {
                            try {
                                return JSON.parse(b.toString())
                            } catch(e) {
                                console.log('invalid json from %s: `%s`', endpoint, b.toString())
                                return b
                            }
                        })
                    }
                }
            })
        })
    },

    getEndpoints: function() {
        return Q.fcall(function() {
            if (_endpointCache !== undefined) {
                return _endpointCache
            } else {
                console.log('requesting endpoints')
                return qhttp.read({
                    charset: "UTF-8", // This gets aronud a q-io bug with browserify
                    url: config.AUTH_URL + '/endpoints',
                    headers: {
                        'X-Request-ID': uuidGen.v1(),
                        "Content-Type": "application/json",
                    }
                }).then(function(b) {
                    _endpointCache = JSON.parse(b.toString())
                    return _endpointCache
                }).fail(function(e) {
                    console.log("failed to fetch the endpoints")
                    throw e
                })
            }
        })
    },

    getAuth: function() {
        if (config.credentials === undefined) {
            throw "no credentials have been configured"
        }

        return self.getEndpoints().then(function(endpoints) {
            var now = new Date().getTime()

            if (_authCache !== undefined && _authCache.expires > now) {
                return _authCache
            } else {
                console.log('requesting auth')
                return qhttp.read({
                    charset: "UTF-8", // This gets aronud a q-io bug with browserify
                    url: endpoints.auth + '/auth?ttl=3600',
                    headers: {
                        'X-Request-ID': uuidGen.v1(),
                        "Content-Type": "application/json",
                        "Authorization": 'Basic ' + new Buffer(config.credentials).toString('base64')
                    }
                }).then(function(b) {
                    try {
                        _authCache = JSON.parse(b.toString())
                        return _authCache
                    } catch(e) {
                        console.log("invalid authentication data", b)
                        throw e
                    }
                }).fail(function(e) {
                    console.log("failed to get auth")
                    throw e
                })
            }
        })
    },
    updateInventory: function(account, data) {
        /* data = [{
            inventory: uuid,
            slice: slice,
            blueprint: type,
            quantity: quantity
        }]
        */
        return self.request("inventory", "POST", 204, "/inventory", data, { sudo_account: account }).tap(self.qDebug('updateInventory'))
    },
    qDebug: function(location) {
        return function(value) {
            debug('qTap:'+location)(value)
        }
    },
    getBlueprints: function() {
        return self.request('tech', 'GET', 200, '/blueprints')
    },
    getAuthToken: function() {
        return self.getAuth().then(function(auth) {
            return auth.token
        })
    }
}

module.exports = self
