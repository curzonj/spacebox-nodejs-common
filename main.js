'use strict';

var Q = require('q');
var qhttp = require("q-io/http");
var uuidGen = require('node-uuid');

Q.longStackSupport = true;

var _endpointCache;
var _authCache;

module.exports = {
    authorize_req: function (req, restricted) {
        var auth_header = req.headers.authorization;

        if (auth_header === undefined) {
            // We do this so that the Q-promise error handling
            // will catch it
            return Q.fcall(function() {
                throw new Error("not authorized");
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
            throw new Error("not authorized");
        }

        // This will fail if it's not authorized
        return qhttp.read({
            method: "POST",
            url: process.env.AUTH_URL + '/token',
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
    // BOBSUNCLE
    request: function (endpoint, method, expects, path, body, opts) {
        if (opts === undefined) {
            opts = {}
        }

        return Q.spread([this.getEndpoints(), this.getAuthToken()], function(endpoints, token) {
            var bearer = token;

            if (opts.sudo_account !== undefined) {
                bearer += '/' + opts.sudo_account;
            }

            return qhttp.request({
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
                    }).done();
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
                return qhttp.read({
                    url: process.env.SPODB_URL + '/endpoints',
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
        return this.getEndpoints().then(function(endpoints) {
            var now = new Date().getTime();

            if (_authCache !== undefined && _authCache.expires > now) {
                return _authCache;
            } else {
                return qhttp.read({
                    url: endpoints.auth + '/auth?ttl=3600',
                    headers: {
                        'X-Request-ID': uuidGen.v1(),
                        "Content-Type": "application/json",
                        "Authorization": 'Basic ' + new Buffer(process.env.INTERNAL_CREDS).toString('base64')
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
        return this.getAuth().then(function(auth) {
            return auth.token;
        });
    }
};
