'use strict';

var deepMerge = require('./deepMerge')
var path = require('path')
var bunyan = require('bunyan')
var uuidGen = require('node-uuid')
var measured = require('measured')


function scheduleStatsLogging(ctx) {
    if (process.env.DISABLE_METRICS === '1')
        return

    var lastRun

    setInterval(function() {
        var values = { stats: ctx.stats }

        if (lastRun) {
            var thisRun = Date.now()
            values.jitter  = thisRun - lastRun - 1000
            lastRun = thisRun
        } else {
            lastRun = Date.now()
        }

        if (process && process.memoryUsage)
            values.memory = process.memoryUsage()

        // TODO we need other ways of delivering
        // metrics
        ctx.debug(values, 'metrics')
    }, 1000)
}

function Context(bunyan, parent) {
    this.prefix = [ ]
    this.limited_prefixes = {}

    if (parent === undefined) {
        this.stats = measured.createCollection()
        this.buildBunyan(bunyan)
        scheduleStatsLogging(this)
    } else {
        this.logger = bunyan
        this.stats = parent.stats
        this.extend(parent)
    }

    if (this.logger === undefined)
        throw new Error("problem creating logging context")
}

deepMerge({
    buildBunyan: function(name) {
        var stdout_level = 'info'
        if (process.env.STDOUT_LOG_LEVEL !== undefined)
            stdout_level = process.env.STDOUT_LOG_LEVEL

        var file_level = 'debug'
        if (process.env.FILE_LOG_LEVEL !== undefined)
            file_level = process.env.FILE_LOG_LEVEL

        var list = [ { level: stdout_level, stream: process.stdout } ]

        if (file_level !== 'none')
            list.push({ level: file_level, path: path.resolve(__filename, '../../../logs/'+name+'.json') })

        if (process.env.DOCKER_IP !== undefined && process.env.GELF_ENABLED == '1') {
            var gelfStream = require('gelf-stream'),
                stream = gelfStream.forBunyan(process.env.DOCKER_IP, 12201)

            list.push({ level: 'debug', type: 'raw', stream: stream })
        }

        var logger = bunyan.createLogger({
            name: name,
            serializers: bunyan.stdSerializers,
            streams: list})

        if (file_level !== 'none') {
            var fileStreamState = logger.streams.filter(function(s) { return s.type === 'file' })[0].stream._writableState

            this.measure('logfile_buffer', 'gauge', function() {
                return fileStreamState.length
            })
        }

        this.logger = logger
    },
    child: function() {
        return new Context(this.logger.child.apply(this.logger, arguments), this)
    },
    measure: function(set_or_name, type, fn) {
        var self = this

        function define(name, type, fn) {
            if (self[name] !== undefined)
                throw new Error(name +' is already defined in stats')

            // fn may be undefined, that's ok
            try {
                self[name] = self.stats[type].call(self.stats, name, fn)
            } catch(e) {
                console.log(name, type, fn)
                console.log(e)

                throw e
            }
        }

        if (typeof set_or_name === 'string') {
            define(set_or_name, type, fn)
        } else {
            for(var n in set_or_name) {
                define(n, set_or_name[n])
            }
        }
    },

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

        this.logger.debug([ name ].concat(this.prefix, other, args).join(' '))
    },
    old_log_with: function(fn, parts, scope) {
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
}, Context.prototype);

[ 'fatal', 'error', 'warn', 'info', 'debug', 'trace' ].forEach(function(name) {
    Context.prototype[name] = function() {
        return this.logger[name].apply(this.logger, arguments)
    }
})

module.exports = {
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
    create: function(name) {
        return new Context(name)
    },
}
