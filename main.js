'use strict';

var Q = require('q');
var qhttp = require("q-io/http");

var _endpointCache;
var _authCache;

module.exports = {
    getEndpoints: function() {
        return Q.fcall(function() {
            if (_endpointCache !== undefined) {
                return _endpointCache;
            } else {
                return qhttp.read({
                    url: process.env.SPODB_URL + '/endpoints',
                    headers: {
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
        this.getAuth().then(function(auth) {
            return auth.token;
        });
    }
};
