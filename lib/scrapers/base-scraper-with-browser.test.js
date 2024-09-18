"use strict";

require("core-js/modules/es.promise");

var _testsUtils = require("../tests/tests-utils");

var _baseScraperWithBrowser = require("./base-scraper-with-browser");

function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys(Object(source), true).forEach(function (key) { _defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const testsConfig = (0, _testsUtils.getTestsConfig)();

function isNoSandbox(browser) {
  // eslint-disable-next-line no-underscore-dangle
  const args = browser._process.spawnargs;
  return args.includes('--no-sandbox');
}

describe('Base scraper with browser', () => {
  beforeAll(() => {
    (0, _testsUtils.extendAsyncTimeout)(); // The default timeout is 5 seconds per async test, this function extends the timeout value
  });
  xtest('should pass custom args to scraper if provided', async () => {
    const options = _objectSpread({}, testsConfig.options, {
      companyId: 'test',
      showBrowser: false,
      args: []
    }); // avoid false-positive result by confirming that --no-sandbox is not a default flag provided by puppeteer


    let baseScraperWithBrowser = new _baseScraperWithBrowser.BaseScraperWithBrowser(options);

    try {
      await baseScraperWithBrowser.initialize(); // @ts-ignore

      expect(baseScraperWithBrowser.browser).toBeDefined(); // @ts-ignore

      expect(isNoSandbox(baseScraperWithBrowser.browser)).toBe(false);
      await baseScraperWithBrowser.terminate(true);
    } catch (e) {
      await baseScraperWithBrowser.terminate(false);
      throw e;
    } // set --no-sandbox flag and expect it to be passed by puppeteer.lunch to the new created browser instance


    options.args = ['--no-sandbox', '--disable-gpu', '--window-size=1920x1080'];
    baseScraperWithBrowser = new _baseScraperWithBrowser.BaseScraperWithBrowser(options);

    try {
      await baseScraperWithBrowser.initialize(); // @ts-ignore

      expect(baseScraperWithBrowser.browser).toBeDefined(); // @ts-ignore

      expect(isNoSandbox(baseScraperWithBrowser.browser)).toBe(true);
      await baseScraperWithBrowser.terminate(true);
    } catch (e) {
      await baseScraperWithBrowser.terminate(false);
      throw e;
    }
  });
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zY3JhcGVycy9iYXNlLXNjcmFwZXItd2l0aC1icm93c2VyLnRlc3QudHMiXSwibmFtZXMiOlsidGVzdHNDb25maWciLCJpc05vU2FuZGJveCIsImJyb3dzZXIiLCJhcmdzIiwiX3Byb2Nlc3MiLCJzcGF3bmFyZ3MiLCJpbmNsdWRlcyIsImRlc2NyaWJlIiwiYmVmb3JlQWxsIiwieHRlc3QiLCJvcHRpb25zIiwiY29tcGFueUlkIiwic2hvd0Jyb3dzZXIiLCJiYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiQmFzZVNjcmFwZXJXaXRoQnJvd3NlciIsImluaXRpYWxpemUiLCJleHBlY3QiLCJ0b0JlRGVmaW5lZCIsInRvQmUiLCJ0ZXJtaW5hdGUiLCJlIl0sIm1hcHBpbmdzIjoiOzs7O0FBQUE7O0FBR0E7Ozs7Ozs7O0FBRUEsTUFBTUEsV0FBVyxHQUFHLGlDQUFwQjs7QUFFQSxTQUFTQyxXQUFULENBQXFCQyxPQUFyQixFQUFtQztBQUNqQztBQUNBLFFBQU1DLElBQUksR0FBR0QsT0FBTyxDQUFDRSxRQUFSLENBQWlCQyxTQUE5QjtBQUNBLFNBQU9GLElBQUksQ0FBQ0csUUFBTCxDQUFjLGNBQWQsQ0FBUDtBQUNEOztBQUVEQyxRQUFRLENBQUMsMkJBQUQsRUFBOEIsTUFBTTtBQUMxQ0MsRUFBQUEsU0FBUyxDQUFDLE1BQU07QUFDZCwwQ0FEYyxDQUNRO0FBQ3ZCLEdBRlEsQ0FBVDtBQUlBQyxFQUFBQSxLQUFLLENBQUMsZ0RBQUQsRUFBbUQsWUFBWTtBQUNsRSxVQUFNQyxPQUFPLHFCQUNSVixXQUFXLENBQUNVLE9BREo7QUFFWEMsTUFBQUEsU0FBUyxFQUFFLE1BRkE7QUFHWEMsTUFBQUEsV0FBVyxFQUFFLEtBSEY7QUFJWFQsTUFBQUEsSUFBSSxFQUFFO0FBSkssTUFBYixDQURrRSxDQVFsRTs7O0FBQ0EsUUFBSVUsc0JBQXNCLEdBQUcsSUFBSUMsOENBQUosQ0FBMkJKLE9BQTNCLENBQTdCOztBQUNBLFFBQUk7QUFDRixZQUFNRyxzQkFBc0IsQ0FBQ0UsVUFBdkIsRUFBTixDQURFLENBRUY7O0FBQ0FDLE1BQUFBLE1BQU0sQ0FBQ0gsc0JBQXNCLENBQUNYLE9BQXhCLENBQU4sQ0FBdUNlLFdBQXZDLEdBSEUsQ0FJRjs7QUFDQUQsTUFBQUEsTUFBTSxDQUFDZixXQUFXLENBQUNZLHNCQUFzQixDQUFDWCxPQUF4QixDQUFaLENBQU4sQ0FBb0RnQixJQUFwRCxDQUF5RCxLQUF6RDtBQUNBLFlBQU1MLHNCQUFzQixDQUFDTSxTQUF2QixDQUFpQyxJQUFqQyxDQUFOO0FBQ0QsS0FQRCxDQU9FLE9BQU9DLENBQVAsRUFBVTtBQUNWLFlBQU1QLHNCQUFzQixDQUFDTSxTQUF2QixDQUFpQyxLQUFqQyxDQUFOO0FBQ0EsWUFBTUMsQ0FBTjtBQUNELEtBcEJpRSxDQXNCbEU7OztBQUNBVixJQUFBQSxPQUFPLENBQUNQLElBQVIsR0FBZSxDQUNiLGNBRGEsRUFFYixlQUZhLEVBR2IseUJBSGEsQ0FBZjtBQUtBVSxJQUFBQSxzQkFBc0IsR0FBRyxJQUFJQyw4Q0FBSixDQUEyQkosT0FBM0IsQ0FBekI7O0FBQ0EsUUFBSTtBQUNGLFlBQU1HLHNCQUFzQixDQUFDRSxVQUF2QixFQUFOLENBREUsQ0FFRjs7QUFDQUMsTUFBQUEsTUFBTSxDQUFDSCxzQkFBc0IsQ0FBQ1gsT0FBeEIsQ0FBTixDQUF1Q2UsV0FBdkMsR0FIRSxDQUlGOztBQUNBRCxNQUFBQSxNQUFNLENBQUNmLFdBQVcsQ0FBQ1ksc0JBQXNCLENBQUNYLE9BQXhCLENBQVosQ0FBTixDQUFvRGdCLElBQXBELENBQXlELElBQXpEO0FBQ0EsWUFBTUwsc0JBQXNCLENBQUNNLFNBQXZCLENBQWlDLElBQWpDLENBQU47QUFDRCxLQVBELENBT0UsT0FBT0MsQ0FBUCxFQUFVO0FBQ1YsWUFBTVAsc0JBQXNCLENBQUNNLFNBQXZCLENBQWlDLEtBQWpDLENBQU47QUFDQSxZQUFNQyxDQUFOO0FBQ0Q7QUFDRixHQXhDSSxDQUFMO0FBeUNELENBOUNPLENBQVIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICBleHRlbmRBc3luY1RpbWVvdXQsIGdldFRlc3RzQ29uZmlnLFxufSBmcm9tICcuLi90ZXN0cy90ZXN0cy11dGlscyc7XG5pbXBvcnQgeyBCYXNlU2NyYXBlcldpdGhCcm93c2VyIH0gZnJvbSAnLi9iYXNlLXNjcmFwZXItd2l0aC1icm93c2VyJztcblxuY29uc3QgdGVzdHNDb25maWcgPSBnZXRUZXN0c0NvbmZpZygpO1xuXG5mdW5jdGlvbiBpc05vU2FuZGJveChicm93c2VyOiBhbnkpIHtcbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLXVuZGVyc2NvcmUtZGFuZ2xlXG4gIGNvbnN0IGFyZ3MgPSBicm93c2VyLl9wcm9jZXNzLnNwYXduYXJncztcbiAgcmV0dXJuIGFyZ3MuaW5jbHVkZXMoJy0tbm8tc2FuZGJveCcpO1xufVxuXG5kZXNjcmliZSgnQmFzZSBzY3JhcGVyIHdpdGggYnJvd3NlcicsICgpID0+IHtcbiAgYmVmb3JlQWxsKCgpID0+IHtcbiAgICBleHRlbmRBc3luY1RpbWVvdXQoKTsgLy8gVGhlIGRlZmF1bHQgdGltZW91dCBpcyA1IHNlY29uZHMgcGVyIGFzeW5jIHRlc3QsIHRoaXMgZnVuY3Rpb24gZXh0ZW5kcyB0aGUgdGltZW91dCB2YWx1ZVxuICB9KTtcblxuICB4dGVzdCgnc2hvdWxkIHBhc3MgY3VzdG9tIGFyZ3MgdG8gc2NyYXBlciBpZiBwcm92aWRlZCcsIGFzeW5jICgpID0+IHtcbiAgICBjb25zdCBvcHRpb25zID0ge1xuICAgICAgLi4udGVzdHNDb25maWcub3B0aW9ucyxcbiAgICAgIGNvbXBhbnlJZDogJ3Rlc3QnLFxuICAgICAgc2hvd0Jyb3dzZXI6IGZhbHNlLFxuICAgICAgYXJnczogW10sXG4gICAgfTtcblxuICAgIC8vIGF2b2lkIGZhbHNlLXBvc2l0aXZlIHJlc3VsdCBieSBjb25maXJtaW5nIHRoYXQgLS1uby1zYW5kYm94IGlzIG5vdCBhIGRlZmF1bHQgZmxhZyBwcm92aWRlZCBieSBwdXBwZXRlZXJcbiAgICBsZXQgYmFzZVNjcmFwZXJXaXRoQnJvd3NlciA9IG5ldyBCYXNlU2NyYXBlcldpdGhCcm93c2VyKG9wdGlvbnMpO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBiYXNlU2NyYXBlcldpdGhCcm93c2VyLmluaXRpYWxpemUoKTtcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIGV4cGVjdChiYXNlU2NyYXBlcldpdGhCcm93c2VyLmJyb3dzZXIpLnRvQmVEZWZpbmVkKCk7XG4gICAgICAvLyBAdHMtaWdub3JlXG4gICAgICBleHBlY3QoaXNOb1NhbmRib3goYmFzZVNjcmFwZXJXaXRoQnJvd3Nlci5icm93c2VyKSkudG9CZShmYWxzZSk7XG4gICAgICBhd2FpdCBiYXNlU2NyYXBlcldpdGhCcm93c2VyLnRlcm1pbmF0ZSh0cnVlKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBhd2FpdCBiYXNlU2NyYXBlcldpdGhCcm93c2VyLnRlcm1pbmF0ZShmYWxzZSk7XG4gICAgICB0aHJvdyBlO1xuICAgIH1cblxuICAgIC8vIHNldCAtLW5vLXNhbmRib3ggZmxhZyBhbmQgZXhwZWN0IGl0IHRvIGJlIHBhc3NlZCBieSBwdXBwZXRlZXIubHVuY2ggdG8gdGhlIG5ldyBjcmVhdGVkIGJyb3dzZXIgaW5zdGFuY2VcbiAgICBvcHRpb25zLmFyZ3MgPSBbXG4gICAgICAnLS1uby1zYW5kYm94JyxcbiAgICAgICctLWRpc2FibGUtZ3B1JyxcbiAgICAgICctLXdpbmRvdy1zaXplPTE5MjB4MTA4MCcsXG4gICAgXTtcbiAgICBiYXNlU2NyYXBlcldpdGhCcm93c2VyID0gbmV3IEJhc2VTY3JhcGVyV2l0aEJyb3dzZXIob3B0aW9ucyk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGJhc2VTY3JhcGVyV2l0aEJyb3dzZXIuaW5pdGlhbGl6ZSgpO1xuICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgZXhwZWN0KGJhc2VTY3JhcGVyV2l0aEJyb3dzZXIuYnJvd3NlcikudG9CZURlZmluZWQoKTtcbiAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgIGV4cGVjdChpc05vU2FuZGJveChiYXNlU2NyYXBlcldpdGhCcm93c2VyLmJyb3dzZXIpKS50b0JlKHRydWUpO1xuICAgICAgYXdhaXQgYmFzZVNjcmFwZXJXaXRoQnJvd3Nlci50ZXJtaW5hdGUodHJ1ZSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgYXdhaXQgYmFzZVNjcmFwZXJXaXRoQnJvd3Nlci50ZXJtaW5hdGUoZmFsc2UpO1xuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH0pO1xufSk7XG4iXX0=