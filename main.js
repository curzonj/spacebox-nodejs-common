'use strict';

var Q = require('q');
var qhttp = require("q-io/http");
var uuidGen = require('node-uuid');

Q.longStackSupport = true;

var _endpointCache;
var _authCache;

var env = (process !== undefined ? process.env : {});

var self = {
     setEnvHash: function(h) {
         env = h
     },
     deepMerge: function (src, tgt) {
        for (var attrname in src) {
            var v = src[attrname];
            if (typeof v == "object" &&
                tgt.hasOwnProperty(attrname) &&
                (typeof(tgt[attrname])) == "object") {

                self.deepMerge(v, tgt[attrname]);
            } else {
                tgt[attrname] = v;
            }
        }

        return tgt;
    },
    authorize_req: function (req, restricted) {
        var auth_header = req.headers.authorization;

        if (auth_header === undefined) {
            // We do this so that the Q-promise error handling
            // will catch it
            return Q.fcall(function() {
                throw new Error("not authorized; missing header");
            });
        }

        var parts = auth_header.split(' ');

        // TODO make a way for internal apis to authorize
        // as a specific account without having to get a
        // different bearer token for each one. Perhaps
        // auth will return a certain account if the authorized
        // token has metadata appended to the end of it
        // or is fernet encoded.
        if (parts[0] != "Bearer") {
            return Q.fcall(function() {
                throw new Error("not authorized; missing bearer");
            });
        }

        // This will fail if it's not authorized
        return qhttp.read({
            charset: "UTF-8", // This gets aronud a q-io bug with browserify
            method: "POST",
            url: env.AUTH_URL + '/token',
            headers: {
                'X-Request-ID': uuidGen.v1(),
                "Content-Type": "application/json"
            },
            body: [JSON.stringify({
                token: parts[1],
                restricted: (restricted === true)
            })]
        }).then(function(body) {
            return JSON.parse(body.toString());
        }).fail(function(e) {
            throw new Error("not authorized");
        });
    },
    request: function (endpoint, method, expects, path, body, opts) {
        if (opts === undefined) {
            opts = {};
        }

        return Q.spread([self.getEndpoints(), self.getAuthToken()], function(endpoints, token) {
            var bearer = token;

            if (opts.sudo_account !== undefined) {
                bearer += '/' + opts.sudo_account;
            }

            console.log('making request to '+endpoint);
            return qhttp.request({
                charset: "UTF-8", // This gets aronud a q-io bug with browserify
                method: method,
                url: endpoints[endpoint] + path,
                headers: {
                    'X-Request-ID': uuidGen.v1(),
                    "Authorization": "Bearer " + bearer,
                    "Content-Type": "application/json"
                },
                body: ( body === undefined ? [] : [JSON.stringify(body)])
            }).then(function(resp) {
                if (resp.status !== expects) {
                    return resp.body.read().then(function(b) {
                        console.log(endpoint+" " + resp.status + " reason: " + b.toString());

                        throw new Error(endpoint+" responded with " + resp.status);
                    });
                } else {
                    if (resp.status !== 204) {
                        return resp.body.read().then(function(b) {
                            try {
                                return JSON.parse(b.toString());
                            } catch(e) {
                                console.log('invalid json from %s: `%s`', endpoint, b.toString());
                                return b;
                            }
                        });
                    }
                }
            });
        });
    },

    getEndpoints: function() {
        return Q.fcall(function() {
            if (_endpointCache !== undefined) {
                return _endpointCache;
            } else {
                console.log('requesting endpoints');
                return qhttp.read({
                    charset: "UTF-8", // This gets aronud a q-io bug with browserify
                    url: env.SPODB_URL + '/endpoints',
                    headers: {
                        'X-Request-ID': uuidGen.v1(),
                        "Content-Type": "application/json",
                    }
                }).then(function(b) {
                    _endpointCache = JSON.parse(b.toString());
                    return _endpointCache;
                }).fail(function(e) {
                    console.log("failed to fetch the endpoints");
                    throw e;
                });
            }
        });
    },

    getAuth: function() {
        return self.getEndpoints().then(function(endpoints) {
            var now = new Date().getTime();

            if (_authCache !== undefined && _authCache.expires > now) {
                return _authCache;
            } else {
                console.log('requesting auth');
                return qhttp.read({
                    charset: "UTF-8", // This gets aronud a q-io bug with browserify
                    url: endpoints.auth + '/auth?ttl=3600',
                    headers: {
                        'X-Request-ID': uuidGen.v1(),
                        "Content-Type": "application/json",
                        "Authorization": 'Basic ' + new Buffer(env.INTERNAL_CREDS).toString('base64')
                    }
                }).then(function(b) {
                    _authCache = JSON.parse(b.toString());

                    return _authCache;
                }).fail(function(e) {
                    console.log("failed to get auth");
                    throw e;
                });
            }
        });
    },

    getAuthToken: function() {
        return self.getAuth().then(function(auth) {
            return auth.token;
        });
    }
};

module.exports = self;
