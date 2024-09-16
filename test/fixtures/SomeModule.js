const { createTracer, createTimer } = require('hypertrace')

module.exports = class SomeModule {
  constructor (props) {
    this.tracer = createTracer(this, { props })
  }

  callTrace (opts) {
    this.tracer.trace(opts)
  }

  async callTimer (name, ms) {
    const stop = createTimer(name)
    await new Promise(resolve => setTimeout(resolve, 200))
    stop()
  }
}
