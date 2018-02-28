const _ = require('lodash');

const defaults = {
  // in this mode we will log each step of
  // the hapi request lifecycle (https://hapijs.com/api#request-lifecycle)
  requestLifecycle: false,
  // verbose mode always logs timings:
  verbose: false,
  // time in ms, longer than this will trigger a warning:
  threshold: 1000,
  // will be included, plus whatever additional tags they want to add:
  tags: ['hapi-timing', 'slow', 'warning']
};

const register = function(server, options) {
  const tags = _.union(options.tags, defaults.tags);
  options = Object.assign({}, defaults, options);

  // when a request took too long, do this:
  const requestTimeoutExpired = (responseTime, threshold, request) => {
    // log the tardiness:
    const output = {
      id: request.info.id,
      responseTime,
      threshold,
      message: `request took ${responseTime}ms to process`,
      url: request.url.path,
      hash: request.url.hash,
      method: request.method,
      userAgent: request.headers['user-agent'],
      referrer: request.info.referrer,
      timings: request.plugins['hapi-timing']
    };
    server.log(tags, output);
  };

  server.decorate('request', 'timingStart', function(key) {
    if (!this.plugins['hapi-timing']) {
      this.plugins['hapi-timing'] = {};
    }
    this.plugins['hapi-timing'][key] = { name: key, start: new Date() };
  });

  server.decorate('request', 'timingEnd', function(key) {
    const timing = this.plugins['hapi-timing'][key];
    this.plugins['hapi-timing'][key].end = new Date();
    this.plugins['hapi-timing'][key].elapsed = timing.end - timing.start;
  });

  if (options.requestLifecycle) {
    const eventNames = ['onRequest', 'onPreAuth', 'onPostAuth', 'onPreHandler', 'onPostHandler'];
    eventNames.forEach((eventName, i) => {
      server.ext(eventName, (request, h) => {
        if (i !== 0) {
          // call timingEnd on previous event:
          request.timingEnd(eventNames[i - 1]);
        }
        request.timingStart(eventName);
        return h.continue;
      });
    });
  }
  server.events.on('response', (request) => {
    // turn off last event handler if we were monitoring each lifecycle segment:
    if (options.requestLifecycle) {
      request.timingEnd('onPostHandler');
    }
    // check the tail response times and notify if needed:
    const responseTime = request.info.responded - request.info.received;
    const plugin = request.route.settings.plugins['hapi-timing'];
    const threshold = (plugin && plugin.threshold) ? plugin.threshold : options.threshold;
    if (options.verbose || responseTime > threshold) {
      requestTimeoutExpired(responseTime, threshold, request);
    }
  });
};

exports.plugin = {
  name: 'hapi-timing',
  register,
  once: true,
  pkg: require('./package.json')
};
