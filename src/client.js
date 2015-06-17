'use strict';

var Q = require('q')
var util = require('util')
var qhttp = require("q-io/http")
var jwt = require('jsonwebtoken')
var uuidGen = require('node-uuid')
var C = require('./main')

Q.longStackSupport = true

module.exports = function(ctx, config) {
    var _endpointCache
    var _authCache

    var self = {
        logger: ctx,
        getAuth: function() {
            var credentials = config.credentials
           
            var now = Math.floor(Date.now() / 1000)
            if (_authCache !== undefined && _authCache.expires > now) {
                return Q(_authCache)
            }

            ctx.debug({ credentials: credentials }, 'requesting auth')
            return qhttp.read({
                charset: "UTF-8", // This gets aronud a q-io bug with browserify
                url: config.AUTH_URL + '/auth?ttl=3600',
                headers: {
                    'X-Request-ID': uuidGen.v1(),
                    "Content-Type": "application/json",
                    "Authorization": 'Basic ' + new Buffer(credentials).toString('base64')
                }
            }).then(function(b) {
                try {
                    var value = b.toString()
                    var decoded = jwt.decode(value)

                    _authCache = {
                        account: decoded.account,
                        expires: decoded.exp,
                        token: value
                    }

                    return _authCache
                } catch(e) {
                    console.log("invalid authentication data", b)
                    throw e
                }
            }).fail(function(e) {
                console.log("failed to get auth")
                throw e
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
            return self.request("api", "POST", 204, "/inventory", data, { sudo_account: account })
        },
        getBlueprint: function() {
            var _cache = {}

            var fn = function(uuid) {
                return Q.fcall(function() {
                    if (_cache[uuid] !== undefined) {
                        return _cache[uuid]
                    } else {
                        return self.request('api', 'GET', 200, '/blueprints/'+uuid).
                        tap(function(data) {
                            _cache[uuid] = data
                        })
                    }
                })
            }

            fn.reset = function() {
                _cache = {}
            }

            return fn
        }(),
        getAuthToken: function() {
            return self.getAuth().then(function(auth) {
                return auth.token
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
        cmd: function (name, opts) {
            ctx.info({ cmd: name }, 'sending command')
            ctx.trace({ cmd: name, opts: opts }, 'command arguments')

            return self.request('api', 'POST', 200, '/commands/'+name, opts).
            then(function(data) {
                return data.result
            })
        },
        request: function (endpoint, method, expects, path, body) {
            return Q.spread([self.getEndpoints(), self.getAuthToken()], function(endpoints, token) {
                ctx.debug({ endpoint: endpoint, method: method, path: path, expects: expects, body: body }, 'making request')
                return qhttp.request({
                    charset: "UTF-8", // This gets aronud a q-io bug with browserify
                    method: method,
                    url: endpoints[endpoint] + path,
                    headers: {
                        'X-Request-ID': uuidGen.v1(),
                        "Authorization": "Bearer " + token,
                        "Content-Type": "application/json"
                    },
                    body: ( (body === undefined || method == "GET") ? [] : [JSON.stringify(body)])
                }).then(function(resp) {
                    if (resp.status !== expects) {
                        return resp.body.read().then(function(b) {
                            ctx.debug(endpoint+" " + resp.status + " reason: " + b.toString())

                            var code, details

                            try {
                                var body = JSON.parse(b.toString())
                                details = body.errorDetails
                                code = body.errorCode
                            } catch(e) {
                                details = b.toString()
                                code = 'unknown'
                            }

                            var err = new C.http.Error(resp.status, code, details)
                            err.request_id = resp.headers['x-request-id']
                            err.request_method = method
                            err.request_service = endpoint
                            err.request_path = path

                            throw err
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
    }

    self.getWebsocket = require('./websockets-wrapper')(self)

    return self
}
