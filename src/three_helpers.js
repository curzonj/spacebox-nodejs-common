'use strict';

module.exports = {
    buildVectorBucket: function (v, bucket) {
        var r = {
            x: Math.floor(v.x / bucket) * bucket,
            y: Math.floor(v.y / bucket) * bucket,
            z: Math.floor(v.z / bucket) * bucket
        }

        if (isNaN(r.x) || isNaN(r.x) || isNaN(r.x))
            throw new Error("NaN vector bucket: "+JSON.stringify({v:v,bucket:bucket}))

        return r
    },

    buildVector: function (v, o) {
        if (o && o.hasOwnProperty('x') && o.hasOwnProperty('y') && o.hasOwnProperty('z')) {
            v.set(o.x, o.y, o.z)
        } else {
            v.set(0, 0, 0)
        }
    },

    buildQuaternion: function(q, o) {
        if (o && o.hasOwnProperty('x') && o.hasOwnProperty('y') && o.hasOwnProperty('z') && o.hasOwnProperty('w')) {
            q.set(o.x, o.y, o.z, o.w)
        } else {
            q.set(0, 0, 0, 0)
        }
    },

    explodeVector: function(v) {
        return {
            x: v.x,
            y: v.y,
            z: v.z
        }
    }
}
