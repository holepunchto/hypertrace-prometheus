const Hypertrace = require('hypertrace')

module.exports = class SomeModule {
  constructor (props) {
    this.tracer = new Hypertrace(this, { props })
  }

  foo (opts) {
    this.tracer.trace(opts)
  }

  getTracingObjectId () {
    this.tracer.trace()
    return this.tracer.getObjectId()
  }
}
