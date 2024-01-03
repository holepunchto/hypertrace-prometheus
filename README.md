# hypertrace-prometheus

Use together with [hypertrace](https://github.com/holepunchto/hypertrace) to add support for Prometheus/Grafana and get better visual insights into an application's behavior.

## Installation

```
$ npm i hypertrace-prometheus hypertrace
```

## Usage / instrumentation

First add `Hypertrace` to classes where insights are needed

`some-module.js`
``` js
import Hypertrace from 'hypertrace'

export default class SomeModule {
  constructor() {
    this.tracer = new Hypertrace(this, { someCustom: 'property' })
  }

  get () {
    this.tracer.trace() // Add where needed
    // ...
  }
}
```

Then add `HypertracePrometheus` in the application, when traces are needed.

`app.js`
``` js
import SomeModule from 'some-module'
import Hypertrace from 'hypertrace'
import HypertracePrometheus from 'hypertrace-prometheus'

const traceFunction = HypertracePrometheus({
  port: 4343,
  allowedProps: ['someCustom']
})
Hypertrace.setTraceFunction(traceFunction)

const mod = new SomeModule()
mod.get()
// traceFunction.stop() // To stop the server
```

While the application is runinng, open http://localhost:4343/metrics to see the recorded metrics.

To set up for use in Prometheus (and optionally Grafana), read the section below.

## Methods

### HypertracePrometheus({ port, register = null, collectDefaults = true, allowedProps = [] })

Returns a trace function that be passed to `Hypertrace`. The trace function looks like `({ id, object, parentObject, caller }) => { ... }`

If `port` is passed, a server is started on http://localhost:{port}/metrics which Prometheus can use as a monitoring target. Read more on how to set this up in sections below.

- **port**: (optional) If passed, then an http server will be started on this port.
- **register**: A Prometheus registry. This is helpful if you need to handle everything yourself.
- **collectDefaults**: By default Prometheus' node client will record some basic metrics. Set to `false` to disallow that.
- **allowedProps**: An array of allow customr properties that will be passed on to Prometheus. This is needed because Prometheus does not allow dynamic creation of labels. Note that in Prometheus the name will be changed, depending on where the prop were captured. So if `allowedProps = ['foo']` then it will be named `object_props_foo`, `parent_object_props_foo`, or `called_props_foo` depending on which prop it is.

### async .metrics()

Returns the metrics. This is helpful to use if not passing `port` and handling the server by yourself. This is similar to Prometheus' `await registry.metrics()`.

### async .stop()

Unregister the metric from the Prometheus registry and stop the server (if `port` was passed).

## Usage with Grafana and Prometheus

Prometheus is a data store for metrics. It works by pulling data from `monitoring targets` and Hypertrace can be set up to one of those. rafana is then used to visualize the data that Prometheus has stored.

A simple graph on how it's working

```
       Application   <--   Prometheus Server   <--   Grafana
(data from HTTP /metrics)     (store data)         (visualize)
```

## How to install and use Prometheus on macOS

**Note**: even though this example is for macOS, most of the steps would be the same for any OS.

### 1. Install and start Prometheus and Grafana

1. `$ brew install prometheus grafana`
2. `$ brew services start prometheus`
3. `$ brew services start grafana`

### 2. Add Prometheus as data source in Grafana

1. Open http://localhost:3000/connections/datasources/prometheus (port 3000 is the default for Grafana)
2. Click on `Add new data source`
3. Write `http://localhost:9090` for `Prometheus server URL`
4. Click `Save & Test`

Verify that it works by going to http://localhost:3000/explore and click on the `Metric` dropdown. It should have a long list of names called `prometheus_...`

### 3. Add your application as a Promethus monitoring target

1. Write some code that uses an server

``` js
const express = require('express')
const Hypertrace = require('hypertrace')
const HypertracePrometheus = require('hypertrace-prometheus')

const app = express()

const traceFunction = HypertracePrometheus({ port: 4343 }) // Port can be anything you want
Hypertrace.setTraceFunction(traceFunction)
```

2. Update the Prometheus config file located at `/opt/homebrew/etc/prometheus.yml`

```
scrape_configs:
  # ...
  - job_name: "my-application"
    static_configs:
    - targets: ["localhost:4343"] # Same port as in the config
```

3. Restart Prometheus

```
$ brew services restart prometheus
```

4. Run your application

Start your application to make sure that Prometheus are able to pull data

5. Verify that Prometheus can pull data

Open http://localhost:9090/targets (port 9090 is the default for Prometheus).

It should say `my-application (1/1 ...)`. Click on `show more` next to it, and verify that the state is `UP`. It may take ~30 seconds after the application has started until there's data.

### 4. Visualize data in Grafana (optional, only if Grafana support is needed)

Everything is now ready to be visualized in Grafana. To make sure that everything works, follow this:

1. Go to http://localhost:3000/dashboard/new to create new dashboard
2. Click `Add visualization`
3. Click `Prometheus`
4. For the `Metric`, use `nodejs_eventloop_lag_seconds` and for `Label filters` set `app=my-application`. You can also use this code directly, `nodejs_eventloop_lag_seconds{app="chat-app"}`
5. Click on `Run queries`
6. A graph should show itself.

### Examples of filters in Grafana

Group function calls to `Hypercore` together to easier investigate which function is being called a lot.

`$__rate_interval` makes then length of each tick/step dynamic

```
sum by (caller_functionname) (
  rate(
    function_counter{object_classname="Hypercore"}[$__rate_interval]
  )
)
```
