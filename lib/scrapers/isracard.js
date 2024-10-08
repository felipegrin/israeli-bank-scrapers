"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _baseIsracardAmex = _interopRequireDefault(require("./base-isracard-amex"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const BASE_URL = 'https://digital.isracard.co.il';
const COMPANY_CODE = '11';

class IsracardScraper extends _baseIsracardAmex.default {
  constructor(options) {
    super(options, BASE_URL, COMPANY_CODE);
  }

}

var _default = IsracardScraper;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zY3JhcGVycy9pc3JhY2FyZC50cyJdLCJuYW1lcyI6WyJCQVNFX1VSTCIsIkNPTVBBTllfQ09ERSIsIklzcmFjYXJkU2NyYXBlciIsIklzcmFjYXJkQW1leEJhc2VTY3JhcGVyIiwiY29uc3RydWN0b3IiLCJvcHRpb25zIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQUE7Ozs7QUFHQSxNQUFNQSxRQUFRLEdBQUcsZ0NBQWpCO0FBQ0EsTUFBTUMsWUFBWSxHQUFHLElBQXJCOztBQUVBLE1BQU1DLGVBQU4sU0FBOEJDLHlCQUE5QixDQUFzRDtBQUNwREMsRUFBQUEsV0FBVyxDQUFDQyxPQUFELEVBQTBCO0FBQ25DLFVBQU1BLE9BQU4sRUFBZUwsUUFBZixFQUF5QkMsWUFBekI7QUFDRDs7QUFIbUQ7O2VBTXZDQyxlIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IElzcmFjYXJkQW1leEJhc2VTY3JhcGVyIGZyb20gJy4vYmFzZS1pc3JhY2FyZC1hbWV4JztcbmltcG9ydCB7IFNjcmFwZXJPcHRpb25zIH0gZnJvbSAnLi9iYXNlLXNjcmFwZXInO1xuXG5jb25zdCBCQVNFX1VSTCA9ICdodHRwczovL2RpZ2l0YWwuaXNyYWNhcmQuY28uaWwnO1xuY29uc3QgQ09NUEFOWV9DT0RFID0gJzExJztcblxuY2xhc3MgSXNyYWNhcmRTY3JhcGVyIGV4dGVuZHMgSXNyYWNhcmRBbWV4QmFzZVNjcmFwZXIge1xuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBTY3JhcGVyT3B0aW9ucykge1xuICAgIHN1cGVyKG9wdGlvbnMsIEJBU0VfVVJMLCBDT01QQU5ZX0NPREUpO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IElzcmFjYXJkU2NyYXBlcjtcbiJdfQ==