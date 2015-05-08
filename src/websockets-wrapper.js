'use strict';

var C = require('../main.js'),
    WebSocket = require('ws'),
    util = require('util'),
    npm_debug = require('debug'),
    log = npm_debug('build:info'),
    error = npm_debug('build:error'),
    debug = npm_debug('build:debug'),
    urlUtil = require("url"),
    events = require('events');
var handlers = {};

var WebsocketWrapper = function (service, path, opts) {
    if (service === undefined || path === undefined) {
        throw new Error("all parameters is required")
    }

    this.service = service
    this.ws_path = path

    if (opts !== undefined) {
        C.deepMerge(opts, this);
    }
}
util.inherits(WebsocketWrapper, events.EventEmitter);

C.deepMerge({
    getReadyState: function() {
        if (this.connection !== undefined) {
            return this.connection.readyState;
        }
    },
    onOpen: function(fn) {
        this.on('open', fn);

        if (this.getReadyState() == WebSocket.OPEN) {
            fn(this.connection);
        }
    },
    close: function() {
        this.connection.close();
    },
    connect: function() {
        var self = this;

        websocketUrl(self.service).then(function(url) {
            var opts = {};

            if (self.token) {
                opts.headers = {
                    "Authorization": 'Bearer ' + self.token
                };
            }

            var conn = new WebSocket(url+self.ws_path, opts);

            conn.onopen = self._onopen.bind(self);
            conn.onclose = self._onclose.bind(self);
            conn.onerror = self._onerror.bind(self);
            conn.onmessage = self._onmessage.bind(self);

            self.connection = conn;
        }).done();
    },
    _onopen: function() {
        this.emit('open', this.connection)
    },

    _onclose: function(e) {
        this.emit('close', e, this.connection)

        debug("waiting 1sec to reconnect");

        this._reconnect();
    },

    _reconnect: function() {
        var self = this;
        setTimeout(function() {
            log("reconnecting");
            self.connect();
        }, 1000);
    },
    _onerror: function(error) {
        debug('WebSocket Error');
        debug(error);

        // Don't emit undhandled error events
        if (this.listeners('error').length > 0) {
            this.emit('error', error, this.connection)
        }

        this._reconnect();
    },
    _onmessage: function(message) {
        this.emit('message', message, this.connection);
    }
}, WebsocketWrapper.prototype)

function websocketUrl(service) {
    return C.getEndpoints().then(function(endpoints) {
        if (endpoints[service] === undefined) {
            throw new Error(Object.keys(endpoints)+ " is missing "+service)
        }

        var new_uri,
        loc = urlUtil.parse(endpoints[service])

        if (loc.protocol === "https:") {
            new_uri = "wss:";
        } else {
            new_uri = "ws:";
        }
        new_uri += "//" + loc.host

        return new_uri
    });
}

module.exports = {
    get: function(service, path, opts) {
        if (handlers[service] === undefined) {
            if (path === undefined) {
                throw new Error("first call to get a websocket must give the path");
            }

            var h = handlers[service] = new WebsocketWrapper(service, path, opts);

            // This is an async call
            h.connect();
        }

        return handlers[service];
    },
}

