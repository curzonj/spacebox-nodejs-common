'use strict';

var C = require('./main.js'),
    WebSocket = require('ws'),
    uuidGen = require('node-uuid'),
    npm_debug = require('debug'),
    debug = npm_debug('c:websocket'),
    Q = require('q'),
    util = require('util'),
    urlUtil = require("url"),
    events = require('events')

var WebsocketWrapper = function (urlq) {
    this.urlq = urlq
    this.reconnectTimer = null
}
util.inherits(WebsocketWrapper, events.EventEmitter)

C.deepMerge({
    getReadyState: function() {
        if (this.connection !== undefined) {
            return this.connection.readyState
        }
    },
    onOpen: function(fn) {
        this.on('open', fn)

        if (this.getReadyState() == WebSocket.OPEN) {
            fn(this.connection)
        }
    },
    cmd: function(name, opts) {
        if (opts === undefined) {
            opts = {}
        }

        opts.command = name
        opts.request_id = uuidGen.v1()
        debug('sending', opts)

        this.connection.send(JSON.stringify(opts))

        return opts.request_id
    },
    close: function() {
        this.connection.close();
    },
    connect: function() {
        var self = this

        Q(self.urlq).then(function(url) {
            var conn = new WebSocket(url)

            conn.onopen = self._onopen.bind(self)
            conn.onclose = self._onclose.bind(self)
            conn.onerror = self._onerror.bind(self)
            conn.onmessage = self._onmessage.bind(self)

            self.connection = conn
        }).done()
    },
    _onopen: function() {
        this.emit('open', this.connection)
    },

    _onclose: function(e) {
        this.emit('close', e, this.connection)
        this._reconnect();
    },
    _reconnect: function() {
        var self = this

        if (self.reconnectTimer !== null)
            return 

        debug("waiting 5sec to reconnect")
        self.reconnectTimer = setTimeout(function() {
            self.reconnectTimer = null

            debug("reconnecting")
            self.connect()
        }, 5000)
    },
    _onerror: function(error) {
        debug('WebSocket Error')
        debug(error)

        // Don't emit undhandled error events
        if (this.listeners('error').length > 0) {
            this.emit('error', error, this.connection)
        }

        this._reconnect()
    },
    _onmessage: function(message) {
        this.emit('message', message, this.connection)
    }
}, WebsocketWrapper.prototype)

function buildScope() {
    var paths={}
    var handlers = {}

    function websocketUrl(service) {
        return Q.spread([C.getEndpoints(), C.getAuthToken()], function(endpoints, token) {
            if (endpoints[service] === undefined) {
                throw new Error(Object.keys(endpoints)+ " is missing "+service)
            }

            var new_uri,
                path = paths[service] || '/',
                loc = urlUtil.parse(endpoints[service])

            if (loc.protocol === "https:") {
                new_uri = "wss:"
            } else {
                new_uri = "ws:"
            }
            new_uri += "//" + loc.host + path + '?token=' + token

            return new_uri
        })
    }

    return {
        registerPath: function(service, path) {
            paths[service] = path
        },
        get: function(service) {
            if (handlers[service] === undefined) {
                var urlq = websocketUrl(service)
                var h = handlers[service] = new WebsocketWrapper(urlq)

                // This is an async call
                h.connect()
            }

            return handlers[service]
        },
    }
}

var defaultScope = module.exports = buildScope()
defaultScope.customScope = buildScope
