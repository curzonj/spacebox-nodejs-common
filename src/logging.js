'use strict';

var deepMerge = require('./deepMerge'),
    stats = require('./stats'),
    path = require('path'),
    bunyan = require('bunyan'),
    uuidGen = require('node-uuid')

function Context(bunyan, parent) {
    this.prefix = [ ]
    this.limited_prefixes = {}
    this.logger = bunyan

    if (bunyan === undefined)
        throw new Error("you must pass in a logger")

    if (parent !== undefined)
        this.extend(parent)
}

var defaultBunyan, defaultContext,
    debug_scopes = process.env.MYDEBUG || ''

deepMerge({
    extend: function(parent) {
        this.prefix = parent.prefix.slice()
        Object.keys(parent.limited_prefixes).forEach(function(k) {
            this.limited_prefixes[k] = parent.limited_prefixes[k].slice()
        }, this)
    },
    old_log: function() {
        var args = Array.prototype.slice.call(arguments),
            name = args.splice(0, 1)[0],
            other = this.limited_prefixes[name] || ''

        this.logger.info([ name ].concat(this.prefix, other, args).join(' '))
    },
    old_debug: function() {
        var args = Array.prototype.slice.call(arguments),
            name = args.splice(0, 1)[0],
            other = this.limited_prefixes[name] || ''

        if (debug_scopes.indexOf(name) > -1 || debug_scopes.indexOf('*') > -1) 
            this.logger.debug([ name ].concat(this.prefix, other, args).join(' '))
    },
    child: function() {
        return new Context(this.logger.child.apply(this.logger, arguments), this)
    },
    old_log_with: function() {
        return this.log_with.apply(this, arguments)
    },
    log_with: function(fn, parts, scope) {
        var ctx = new Context(this.logger, this)
        if (scope === undefined) {
            ctx.prefix = ctx.prefix.concat(parts)
        } else {
            if (ctx.limited_prefixes[scope] === undefined)
                ctx.limited_prefixes[scope] = []
            ctx.limited_prefixes[scope] = ctx.limited_prefixes[scope].concat(parts)
        }

        return fn(ctx)
    },
    getBunyan: function() {
        return this.logger
    }
}, Context.prototype);

[ 'fatal', 'error', 'warn', 'info', 'debug', 'trace' ].forEach(function(name) {
    Context.prototype[name] = function() {
        return this.logger[name].apply(this.logger, arguments)
    }
})

var named_loggers = {}

var self = module.exports = {
    trace: function(fn_name, fn) {
        // TODO add `measured` stats to this
        return function(ctx) {
            var args = Array.prototype.slice.call(arguments),
                now = Date.now()

            args.splice(0, 1)

            ctx.trace({ args: args, trace_fn: fn_name }, 'start fn')

            function traceEnd(out) {
                ctx.trace({
                    trace_fn: fn_name,
                    duration: Date.now() - now,
                    promise: true,
                    result: out
                }, 'end fn')
            }

            var result = fn.apply(this, arguments)
            if (typeof result.tap == 'function') {
                return result.tap(traceEnd)
            } else {
                traceEnd(result)
                return result
            }
        }
    },
    defaultCtx: function() {
        if (defaultContext === undefined)
            defaultContext = self.create()

        return defaultContext
    },
    create: function(bunyan) {
        if (typeof bunyan === 'string')
            throw new Error("the logging.create api has changed")

        if (bunyan === undefined)
            bunyan = defaultBunyan

        if (bunyan === undefined)
            throw new Error("C.logging is not configured yet")

        return new Context(bunyan)
    },
    configure: function(name) {
        defaultBunyan = self.buildBunyan(name)
    },
    buildBunyan: function(name) {
        if (named_loggers[name])
            return named_loggers[name]

        var stdout_level = 'info'
        if (process.env.STDOUT_LOG_LEVEL !== undefined)
            stdout_level = process.env.STDOUT_LOG_LEVEL

        var file_level = 'debug'
        if (process.env.FILE_LOG_LEVEL !== undefined)
            file_level = process.env.FILE_LOG_LEVEL

        var list = [
            { level: file_level, path: path.resolve(__filename, '../../../logs/'+name+'.json') },
            { level: stdout_level, stream: process.stdout },
        ]

        if (process.env.DOCKER_IP !== undefined && process.env.GELF_ENABLED == '1') {
            var gelfStream = require('gelf-stream'),
                stream = gelfStream.forBunyan(process.env.DOCKER_IP, 12201)

            list.push({ level: 'debug', type: 'raw', stream: stream })
        }

        var logger = bunyan.createLogger({
            name: name,
            serializers: bunyan.stdSerializers,
            streams: list})
        named_loggers[name] = logger

        var fileStreamState = logger.streams.filter(function(s) { return s.type === 'file' })[0].stream._writableState

        stats.define(name+'_logfile_buffer', 'gauge', function() {
            return fileStreamState.length
        })

        return logger
    }
}
