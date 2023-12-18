const { createTracer } = require('hypertrace')

module.exports = class SomeModule {
  constructor (props) {
    this.tracer = createTracer(this, { props })
  }

  foo (opts) {
    this.tracer.trace(opts)
  }

  getTracingObjectId () {
    this.tracer.trace()
    return this.tracer.getObjectId()
  }
}
