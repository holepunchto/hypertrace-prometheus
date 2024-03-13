const test = require('brittle')
const HypertracePrometheus = require('../')
const Prometheus = require('prom-client')
const SomeModule = require('./fixtures/SomeModule.js')
const axios = require('axios')
const {
  clearTraceFunction,
  setTraceFunction,
  createTracer,
  setTimerFunction,
  clearTimerFunction
  // setMemoryFunction,
  // clearMemoryFunction
} = require('hypertrace')
const http = require('http')

let hp

async function teardown () {
  await hp.stop()
  Prometheus.register.clear()
  clearTraceFunction()
  clearTimerFunction()
  // clearMemoryFunction()
}

test('Creates http server with /metrics endpoint', async t => {
  t.teardown(teardown)
  t.plan(1)

  hp = new HypertracePrometheus({ port: 4343 })
  hp.createTraceFunction()
  const { data } = await axios.get('http://localhost:4343/metrics')
  t.ok(data.includes('# HELP trace_counter Counts how many times a function has been traced'))
})

test('Calling stop() stops http server', async t => {
  t.teardown(teardown)
  t.plan(2)

  hp = new HypertracePrometheus({ port: 4343 })
  const { status } = await axios.get('http://localhost:4343/metrics')
  t.is(status, 200)

  hp.stop()
  t.exception(async () => {
    await axios.get('http://localhost:4343/metrics', { timeout: 1000 })
  })
})

test('Setting collectDefaults = true adds default metrics', async t => {
  t.teardown(teardown)
  t.plan(1)

  hp = new HypertracePrometheus({ port: 4343, collectDefaults: true })
  const { data } = await axios.get('http://localhost:4343/metrics')
  t.ok(data.includes('process_cpu_user_seconds_total'))
})

test('Setting collectDefaults = false does not add default metrics', async t => {
  t.teardown(teardown)
  t.plan(1)

  hp = new HypertracePrometheus({ port: 4343, collectDefaults: false })
  const { data } = await axios.get('http://localhost:4343/metrics')
  t.absent(data.includes('process_cpu_user_seconds_total'))
})

test('Labels are set for trace_counter', async t => {
  t.teardown(teardown)
  t.plan(6)

  hp = new HypertracePrometheus({ port: 4343, collectDefaults: false })
  const tf = hp.createTraceFunction()
  setTraceFunction(tf)

  const someModule = new SomeModule()
  someModule.callTrace('foobar')

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, typeStr, counterStr] = data.split('\n')
  t.is(typeStr, '# TYPE trace_counter counter')
  t.ok(counterStr.includes('id="foobar"'))
  t.ok(counterStr.includes('object_classname="SomeModule"'))
  t.ok(counterStr.includes('object_id="'))
  t.ok(counterStr.includes('caller_functionname="callTrace"'))
  t.ok(counterStr.match(/caller_filename="[^"]*\/test\/fixtures\/SomeModule.js"/))
})

test('parentObject properties are not set if no parent tracer is set', async t => {
  t.teardown(teardown)
  t.plan(1)

  hp = new HypertracePrometheus({ port: 4343, collectDefaults: false })
  const tf = hp.createTraceFunction()
  setTraceFunction(tf)

  const someModule = new SomeModule()
  someModule.callTrace()

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr] = data.split('\n')
  t.absent(counterStr.includes('parent_object'))
})

test('parentObject is set if parent tracer is set', async t => {
  t.teardown(teardown)
  t.plan(4)

  hp = new HypertracePrometheus({ port: 4343, collectDefaults: false })
  const tf = hp.createTraceFunction()
  setTraceFunction(tf)

  class Parent {
    constructor () {
      this.tracer = createTracer(this)
    }

    createChild () {
      return new Child(this.tracer)
    }
  }

  class Child {
    constructor (parenTracer) {
      this.tracer = createTracer(this, { parent: parenTracer })
    }

    callTrace () {
      this.tracer.trace()
    }
  }

  const parent = new Parent()
  const child = parent.createChild()
  child.callTrace()

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr] = data.split('\n')
  t.ok(counterStr.includes('object_classname="Child'))
  t.ok(counterStr.includes('object_id="1"'))
  t.ok(counterStr.includes('parent_object_classname="Parent'))
  t.ok(counterStr.includes('parent_object_id="1"'))
})

test('Counter is set for trace_counter', async t => {
  t.teardown(teardown)
  t.plan(2)

  hp = new HypertracePrometheus({ port: 4343, collectDefaults: false })
  const tf = hp.createTraceFunction()
  setTraceFunction(tf)

  const someModule = new SomeModule()

  someModule.callTrace()

  const { data: data1 } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr1] = data1.split('\n')
  t.is(counterStr1[counterStr1.length - 1], '1')

  someModule.callTrace()

  const { data: data2 } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr2] = data2.split('\n')
  t.is(counterStr2[counterStr2.length - 1], '2')
})

test('Collect props passed to caller', async t => {
  t.teardown(teardown)
  t.plan(1)

  hp = new HypertracePrometheus({
    port: 4343,
    collectDefaults: false
  })
  const tf = hp.createTraceFunction({
    allowedProps: ['baz']
  })
  setTraceFunction(tf)

  const someProps = {
    baz: 42
  }
  const someModule = new SomeModule()
  someModule.callTrace(someProps)

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr] = data.split('\n')
  t.ok(counterStr.includes('caller_props_baz="42"'))
})

test('Collect props passed at initiation as object_props_[name]', async t => {
  t.teardown(teardown)
  t.plan(1)

  hp = new HypertracePrometheus({
    port: 4343,
    collectDefaults: false
  })
  const tf = hp.createTraceFunction({
    allowedProps: ['foo']
  })
  setTraceFunction(tf)

  const someProps = {
    foo: 'bleh'
  }
  const someModule = new SomeModule(someProps)
  someModule.callTrace()

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr] = data.split('\n')
  t.ok(counterStr.includes('object_props_foo="bleh"'))
})

test('Collect props passed to parents initiations', async t => {
  t.teardown(teardown)
  t.plan(1)

  hp = new HypertracePrometheus({
    port: 4343,
    collectDefaults: false
  })
  const tf = hp.createTraceFunction({
    allowedProps: ['foo']
  })
  setTraceFunction(tf)

  const someProps = {
    foo: 'bar'
  }

  class Parent {
    constructor () {
      this.tracer = createTracer(this, { props: someProps })
    }

    createChild () {
      return new Child(this.tracer)
    }
  }

  class Child {
    constructor (parentTracer) {
      this.tracer = createTracer(this, { parent: parentTracer })
    }

    callTrace () {
      this.tracer.trace()
    }
  }

  const parent = new Parent()
  const child = parent.createChild()
  child.callTrace()

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr] = data.split('\n')
  t.ok(counterStr.includes('parent_object_props_foo="bar"'))
})

test('Setting non-allowed custom properties means they are not captured', async t => {
  t.teardown(teardown)
  t.plan(2)

  hp = new HypertracePrometheus({
    port: 4343,
    collectDefaults: false
  })
  const tf = hp.createTraceFunction({
    allowedProps: ['someAllowedProperty']
  })
  setTraceFunction(tf)

  const props = {
    someAllowedProperty: 'foo',
    someNonallowedProperty: 'bar'
  }
  const someModule = new SomeModule(props)
  someModule.callTrace()

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr] = data.split('\n')
  t.ok(counterStr.includes('someAllowedProperty'))
  t.absent(counterStr.includes('someNonallowedProperty'))
})

test('Collecting custom properties with illegal label characters, changes the char to underscore', async t => {
  t.teardown(teardown)
  t.plan(2)

  hp = new HypertracePrometheus({
    port: 4343,
    collectDefaults: false
  })
  const tf = hp.createTraceFunction({
    allowedProps: ['foo-bar']
  })
  setTraceFunction(tf)

  const someProps = {
    'foo-bar': 'foo'
  }
  const someModule = new SomeModule(someProps)
  someModule.callTrace()

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, , counterStr] = data.split('\n')
  t.ok(counterStr.includes('foo_bar'))
  t.absent(counterStr.includes('foo-bar'))
})

test('Passing own register means that user is able to read metrics on the passed register', async t => {
  t.teardown(teardown)
  t.plan(3)

  const register = new Prometheus.Registry()
  hp = new HypertracePrometheus({
    register,
    collectDefaults: false
  })
  const tf = hp.createTraceFunction()
  setTraceFunction(tf)

  const someModule = new SomeModule()
  someModule.callTrace()

  const metrics = await register.metrics()
  const traceMetric = metrics.split('\n')[2]
  t.ok(traceMetric.includes('object_classname="SomeModule"'))
  t.ok(traceMetric.includes('caller_functionname="callTrace"'))
  t.ok(traceMetric.endsWith('1'))
})

test('Passing own register and port starts server on that port', async t => {
  t.teardown(teardown)
  t.plan(1)

  const register = new Prometheus.Registry()
  hp = new HypertracePrometheus({
    register,
    port: 4343,
    collectDefaults: false
  })
  const tf = hp.createTraceFunction()
  setTraceFunction(tf)

  const someModule = new SomeModule()
  someModule.callTrace()

  const { data } = await axios.get('http://localhost:4343/metrics')
  t.ok(data.includes('# HELP trace_counter Counts how many times a function has been traced'))
})

test('If passing own server, should implement using .metrics()', async t => {
  t.teardown(teardown)
  t.plan(2)

  const server = http.createServer(async (_, res) => {
    const metrics = await hp.metrics()
    res.end(metrics)
  })
  server.listen(4342)
  hp = new HypertracePrometheus({
    server,
    collectDefaults: false
  })
  const tf = hp.createTraceFunction()
  setTraceFunction(tf)

  // No server running on 4343
  t.exception(async () => {
    await axios.get('http://localhost:4343/metrics', { timeout: 1000 })
  })

  const { data } = await axios.get('http://localhost:4342')
  t.ok(data.includes('# HELP trace_counter Counts how many times a function has been traced'))
  server.close()
})

// test('Using createMemoryFunction generates a gauge', async t => {
//   t.teardown(teardown)
//   t.plan(2)

//   hp = new HypertracePrometheus({
//     port: 4343,
//     collectDefaults: false
//   })
//   const mf = hp.createMemoryFunction()
//   setMemoryFunction(mf)

//   class Foo {
//     constructor () {
//       this.tracer = createTracer(this)
//     }
//   }
//   const arr = [new Foo()]

//   const { data: data1 } = await axios.get('http://localhost:4343/metrics')
//   const instanceLifetimeGaugeStr1 = data1.split('\n').find(l => l.startsWith('memory_instance_lifetime_gauge'))
//   t.is(instanceLifetimeGaugeStr1, 'memory_instance_lifetime_gauge{object_classname="Foo",object_id="1"} 1')

//   arr.shift()
//   global.gc()
//   await new Promise(resolve => setTimeout(resolve, 200)) // Hack: wait for gc to kick in

//   const { data: data2 } = await axios.get('http://localhost:4343/metrics')
//   const instanceLifetimeGaugeStr2 = data2.split('\n').find(l => l.startsWith('memory_instance_lifetime_gauge'))
//   t.is(instanceLifetimeGaugeStr2, 'memory_instance_lifetime_gauge{object_classname="Foo",object_id="1"} 0')
// })

// test('Using createMemoryFunction with several object types creates several lines', async t => {
//   t.teardown(teardown)
//   t.plan(2)

//   hp = new HypertracePrometheus({
//     port: 4343,
//     collectDefaults: false
//   })
//   const mf = hp.createMemoryFunction()
//   setMemoryFunction(mf)

//   class Foo {
//     constructor () {
//       this.tracer = createTracer(this)
//     }
//   }
//   class Bar {
//     constructor () {
//       this.tracer = createTracer(this)
//     }
//   }

//   new Foo() // eslint-disable-line no-new
//   new Bar() // eslint-disable-line no-new

//   const { data } = await axios.get('http://localhost:4343/metrics')
//   const [fooGaugeStr, barGaugeStr] = data.split('\n').filter(l => l.startsWith('memory_instance_lifetime_gauge'))
//   t.is(fooGaugeStr, 'memory_instance_lifetime_gauge{object_classname="Foo",object_id="1"} 1')
//   t.is(barGaugeStr, 'memory_instance_lifetime_gauge{object_classname="Bar",object_id="1"} 1')
// })

// test('Using allowedProps with createMemoryFunction', async t => {
//   t.teardown(teardown)
//   t.plan(1)

//   hp = new HypertracePrometheus({
//     port: 4343,
//     collectDefaults: false
//   })
//   const mf = hp.createMemoryFunction({ allowedProps: ['someProp'] })
//   setMemoryFunction(mf)
//   new SomeModule({ someProp: 'value' }) // eslint-disable-line no-new

//   const { data } = await axios.get('http://localhost:4343/metrics')
//   t.ok(data.includes('object_props_someProp="value"'))
// })

// test('Lifetime count is set to 1 when object is alive, and 0 when it is gc\'ed', async t => {
//   t.teardown(teardown)
//   t.plan(2)

//   hp = new HypertracePrometheus({
//     port: 4343,
//     collectDefaults: false
//   })
//   const mf = hp.createMemoryFunction()
//   setMemoryFunction(mf)

//   class Foo {
//     constructor () {
//       this.tracer = createTracer(this)
//     }
//   }

//   const arr = [new Foo()]

//   const { data: data1 } = await axios.get('http://localhost:4343/metrics')
//   const instanceLifetimeGaugeStr1 = data1.split('\n').find(l => l.startsWith('memory_instance_lifetime_gauge'))
//   t.is(instanceLifetimeGaugeStr1, 'memory_instance_lifetime_gauge{object_classname="Foo",object_id="1"} 1')

//   arr.shift()
//   global.gc()
//   await new Promise(resolve => setTimeout(resolve, 200))

//   const { data: data2 } = await axios.get('http://localhost:4343/metrics')
//   const instanceLifetimeGaugeStr2 = data2.split('\n').find(l => l.startsWith('memory_instance_lifetime_gauge'))
//   t.is(instanceLifetimeGaugeStr2, 'memory_instance_lifetime_gauge{object_classname="Foo",object_id="1"} 0')
// })

test('Using createTimerFunction create a counter', async t => {
  t.teardown(teardown)
  t.plan(3)

  hp = new HypertracePrometheus({
    port: 4343,
    collectDefaults: false
  })

  const tf = hp.createTimerFunction()
  setTimerFunction(tf)

  const someModule = new SomeModule()
  await someModule.callTimer('foobar', 200)

  const { data } = await axios.get('http://localhost:4343/metrics')
  const [, typeStr, counterStr] = data.split('\n')
  const [labelStr, time] = counterStr.split(' ')
  t.is(typeStr, '# TYPE timer_counter counter')
  t.is(labelStr, 'timer_counter{name="foobar"}')
  t.ok(Number(time) >= 200)
})
