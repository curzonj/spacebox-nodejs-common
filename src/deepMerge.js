'use strict';

module.exports = function deepMerge(src, tgt, opts) {
    if (opts === undefined)
        opts = {}

     Object.keys(src).forEach(function(attrname) {
        var v = src[attrname]

        if (Array.isArray(v)) {
            var a1 = tgt[attrname]
            if (a1 === undefined) {
                tgt[attrname] = v
            } else {
                if (!Array.isArray(a1)) {
                    console.log('src', src)
                    console.log('tgt', tgt)
                
                    throw("incompatible deepMerge, non-array on "+attrname+'.')
                }

                if (opts.arrayConcat) {
                    tgt[attrname] = a1.concat(v)
                } else {
                    tgt[attrname] = v
                }
            }
        } else if (typeof v == "object" &&
            tgt.hasOwnProperty(attrname)) {

            if (Array.isArray(tgt[attrname]) ||
                (typeof(tgt[attrname])) != "object") {

                console.log('src', src)
                console.log('tgt', tgt)
            
                throw("incompatible deepMerge, non-object on "+attrname)
            }

            deepMerge(v, tgt[attrname])
        } else if (v !== undefined){
            tgt[attrname] = v
        }
    })

    return tgt
}
