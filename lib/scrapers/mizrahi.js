"use strict";

require("core-js/modules/es.array.iterator");

require("core-js/modules/es.promise");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _moment = _interopRequireDefault(require("moment"));

var _constants = require("../constants");

var _elementsInteractions = require("../helpers/elements-interactions");

var _fetch = require("../helpers/fetch");

var _navigation = require("../helpers/navigation");

var _transactions = require("../transactions");

var _baseScraper = require("./base-scraper");

var _baseScraperWithBrowser = require("./base-scraper-with-browser");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const BASE_WEBSITE_URL = 'https://www.mizrahi-tefahot.co.il';
const LOGIN_URL = `${BASE_WEBSITE_URL}/login/index.html#/auth-page-he`;
const BASE_APP_URL = 'https://mto.mizrahi-tefahot.co.il';
const AFTER_LOGIN_BASE_URL = /https:\/\/mto\.mizrahi-tefahot\.co\.il\/OnlineApp\/.*/;
const OSH_PAGE = '/osh/legacy/legacy-Osh-Main';
const TRANSACTIONS_PAGE = '/osh/legacy/root-main-osh-p428New';
const TRANSACTIONS_REQUEST_URLS = [`${BASE_APP_URL}/OnlinePilot/api/SkyOSH/get428Index`, `${BASE_APP_URL}/Online/api/SkyOSH/get428Index`];
const PENDING_TRANSACTIONS_PAGE = '/osh/legacy/legacy-Osh-p420';
const PENDING_TRANSACTIONS_IFRAME = 'p420.aspx';
const CHANGE_PASSWORD_URL = /https:\/\/www\.mizrahi-tefahot\.co\.il\/login\/\w+\/index\.html#\/change-pass/;
const DATE_FORMAT = 'DD/MM/YYYY';
const MAX_ROWS_PER_REQUEST = 10000000000;
const usernameSelector = '#emailDesktopHeb';
const passwordSelector = '#passwordIDDesktopHEB';
const submitButtonSelector = '.form-desktop button';
const invalidPasswordSelector = 'a[href*="https://sc.mizrahi-tefahot.co.il/SCServices/SC/P010.aspx"]';
const afterLoginSelector = '#dropdownBasic';
const loginSpinnerSelector = 'div.ngx-overlay.loading-foreground';
const accountDropDownItemSelector = '#AccountPicker .item';
const pendingTrxIdentifierId = '#ctl00_ContentPlaceHolder2_panel1';
const checkingAccountTabHebrewName = 'עובר ושב';
const checkingAccountTabEnglishName = 'Checking Account';

function createLoginFields(credentials) {
  return [{
    selector: usernameSelector,
    value: credentials.username
  }, {
    selector: passwordSelector,
    value: credentials.password
  }];
}

function getPossibleLoginResults(page) {
  return {
    [_baseScraperWithBrowser.LoginResults.Success]: [AFTER_LOGIN_BASE_URL, async () => !!(await page.$x(`//a//span[contains(., "${checkingAccountTabHebrewName}") or contains(., "${checkingAccountTabEnglishName}")]`))],
    [_baseScraperWithBrowser.LoginResults.InvalidPassword]: [async () => !!(await page.$(invalidPasswordSelector))],
    [_baseScraperWithBrowser.LoginResults.ChangePassword]: [CHANGE_PASSWORD_URL]
  };
}

function getStartMoment(optionsStartDate) {
  const defaultStartMoment = (0, _moment.default)().subtract(1, 'years');
  const startDate = optionsStartDate || defaultStartMoment.toDate();
  return _moment.default.max(defaultStartMoment, (0, _moment.default)(startDate));
}

function createDataFromRequest(request, optionsStartDate) {
  const data = JSON.parse(request.postData() || '{}');
  data.inFromDate = getStartMoment(optionsStartDate).format(DATE_FORMAT);
  data.inToDate = (0, _moment.default)().format(DATE_FORMAT);
  data.table.maxRow = MAX_ROWS_PER_REQUEST;
  return data;
}

function createHeadersFromRequest(request) {
  return {
    mizrahixsrftoken: request.headers().mizrahixsrftoken,
    'Content-Type': request.headers()['content-type']
  };
}

function convertTransactions(txns) {
  return txns.map(row => {
    const txnDate = (0, _moment.default)(row.MC02PeulaTaaEZ, _moment.default.HTML5_FMT.DATETIME_LOCAL_SECONDS).toISOString();
    return {
      type: _transactions.TransactionTypes.Normal,
      identifier: row.MC02AsmahtaMekoritEZ ? parseInt(row.MC02AsmahtaMekoritEZ, 10) : undefined,
      date: txnDate,
      processedDate: txnDate,
      originalAmount: row.MC02SchumEZ,
      originalCurrency: _constants.SHEKEL_CURRENCY,
      chargedAmount: row.MC02SchumEZ,
      description: row.MC02TnuaTeurEZ,
      status: _transactions.TransactionStatuses.Completed
    };
  });
}

async function extractPendingTransactions(page) {
  const pendingTxn = await (0, _elementsInteractions.pageEvalAll)(page, 'tr.rgRow', [], trs => {
    return trs.map(tr => Array.from(tr.querySelectorAll('td'), td => td.textContent || ''));
  });
  return pendingTxn.map(txn => {
    const date = (0, _moment.default)(txn[0], 'DD/MM/YY').toISOString();
    const amount = parseInt(txn[3], 10);
    return {
      type: _transactions.TransactionTypes.Normal,
      date,
      processedDate: date,
      originalAmount: amount,
      originalCurrency: _constants.SHEKEL_CURRENCY,
      chargedAmount: amount,
      description: txn[1],
      status: _transactions.TransactionStatuses.Pending
    };
  });
}

async function postLogin(page) {
  await Promise.race([(0, _elementsInteractions.waitUntilElementFound)(page, afterLoginSelector), (0, _elementsInteractions.waitUntilElementFound)(page, invalidPasswordSelector), (0, _navigation.waitForUrl)(page, CHANGE_PASSWORD_URL)]);
}

class MizrahiScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  getLoginOptions(credentials) {
    return {
      loginUrl: LOGIN_URL,
      fields: createLoginFields(credentials),
      submitButtonSelector,
      checkReadiness: async () => (0, _elementsInteractions.waitUntilElementDisappear)(this.page, loginSpinnerSelector),
      postAction: async () => postLogin(this.page),
      possibleResults: getPossibleLoginResults(this.page)
    };
  }

  async fetchData() {
    await this.page.$eval('#dropdownBasic, .item', el => el.click());
    const numOfAccounts = (await this.page.$$(accountDropDownItemSelector)).length;

    try {
      const results = [];

      for (let i = 0; i < numOfAccounts; i += 1) {
        if (i > 0) {
          await this.page.$eval('#dropdownBasic, .item', el => el.click());
        }

        await this.page.$eval(`${accountDropDownItemSelector}:nth-child(${i + 1})`, el => el.click());
        results.push((await this.fetchAccount()));
      }

      return {
        success: true,
        accounts: results
      };
    } catch (e) {
      return {
        success: false,
        errorType: _baseScraper.ScraperErrorTypes.Generic,
        errorMessage: e.message
      };
    }
  }

  async fetchAccount() {
    await this.page.$eval(`a[href*="${OSH_PAGE}"]`, el => el.click());
    await (0, _elementsInteractions.waitUntilElementFound)(this.page, `a[href*="${TRANSACTIONS_PAGE}"]`);
    await this.page.$eval(`a[href*="${TRANSACTIONS_PAGE}"]`, el => el.click());
    const response = await Promise.any(TRANSACTIONS_REQUEST_URLS.map(async url => {
      const request = await this.page.waitForRequest(url);
      const data = createDataFromRequest(request, this.options.startDate);
      const headers = createHeadersFromRequest(request);
      return (0, _fetch.fetchPostWithinPage)(this.page, url, data, headers);
    }));

    if (!response || response.header.success === false) {
      throw new Error(`Error fetching transaction. Response message: ${response ? response.header.messages[0].text : ''}`);
    }

    const relevantRows = response.body.table.rows.filter(row => row.RecTypeSpecified);
    const oshTxn = convertTransactions(relevantRows); // workaround for a bug which the bank's API returns transactions before the requested start date

    const startMoment = getStartMoment(this.options.startDate);
    const oshTxnAfterStartDate = oshTxn.filter(txn => (0, _moment.default)(txn.date).isSameOrAfter(startMoment));
    await this.page.$eval(`a[href*="${PENDING_TRANSACTIONS_PAGE}"]`, el => el.click());
    const frame = await (0, _elementsInteractions.waitUntilIframeFound)(this.page, f => f.url().includes(PENDING_TRANSACTIONS_IFRAME));
    await (0, _elementsInteractions.waitUntilElementFound)(frame, pendingTrxIdentifierId);
    const pendingTxn = await extractPendingTransactions(frame);
    const allTxn = oshTxnAfterStartDate.concat(pendingTxn);
    return {
      accountNumber: response.body.fields.AccountNumber,
      txns: allTxn,
      balance: +response.body.fields.YitraLeloChekim
    };
  }

}

var _default = MizrahiScraper;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zY3JhcGVycy9taXpyYWhpLnRzIl0sIm5hbWVzIjpbIkJBU0VfV0VCU0lURV9VUkwiLCJMT0dJTl9VUkwiLCJCQVNFX0FQUF9VUkwiLCJBRlRFUl9MT0dJTl9CQVNFX1VSTCIsIk9TSF9QQUdFIiwiVFJBTlNBQ1RJT05TX1BBR0UiLCJUUkFOU0FDVElPTlNfUkVRVUVTVF9VUkxTIiwiUEVORElOR19UUkFOU0FDVElPTlNfUEFHRSIsIlBFTkRJTkdfVFJBTlNBQ1RJT05TX0lGUkFNRSIsIkNIQU5HRV9QQVNTV09SRF9VUkwiLCJEQVRFX0ZPUk1BVCIsIk1BWF9ST1dTX1BFUl9SRVFVRVNUIiwidXNlcm5hbWVTZWxlY3RvciIsInBhc3N3b3JkU2VsZWN0b3IiLCJzdWJtaXRCdXR0b25TZWxlY3RvciIsImludmFsaWRQYXNzd29yZFNlbGVjdG9yIiwiYWZ0ZXJMb2dpblNlbGVjdG9yIiwibG9naW5TcGlubmVyU2VsZWN0b3IiLCJhY2NvdW50RHJvcERvd25JdGVtU2VsZWN0b3IiLCJwZW5kaW5nVHJ4SWRlbnRpZmllcklkIiwiY2hlY2tpbmdBY2NvdW50VGFiSGVicmV3TmFtZSIsImNoZWNraW5nQWNjb3VudFRhYkVuZ2xpc2hOYW1lIiwiY3JlYXRlTG9naW5GaWVsZHMiLCJjcmVkZW50aWFscyIsInNlbGVjdG9yIiwidmFsdWUiLCJ1c2VybmFtZSIsInBhc3N3b3JkIiwiZ2V0UG9zc2libGVMb2dpblJlc3VsdHMiLCJwYWdlIiwiTG9naW5SZXN1bHRzIiwiU3VjY2VzcyIsIiR4IiwiSW52YWxpZFBhc3N3b3JkIiwiJCIsIkNoYW5nZVBhc3N3b3JkIiwiZ2V0U3RhcnRNb21lbnQiLCJvcHRpb25zU3RhcnREYXRlIiwiZGVmYXVsdFN0YXJ0TW9tZW50Iiwic3VidHJhY3QiLCJzdGFydERhdGUiLCJ0b0RhdGUiLCJtb21lbnQiLCJtYXgiLCJjcmVhdGVEYXRhRnJvbVJlcXVlc3QiLCJyZXF1ZXN0IiwiZGF0YSIsIkpTT04iLCJwYXJzZSIsInBvc3REYXRhIiwiaW5Gcm9tRGF0ZSIsImZvcm1hdCIsImluVG9EYXRlIiwidGFibGUiLCJtYXhSb3ciLCJjcmVhdGVIZWFkZXJzRnJvbVJlcXVlc3QiLCJtaXpyYWhpeHNyZnRva2VuIiwiaGVhZGVycyIsImNvbnZlcnRUcmFuc2FjdGlvbnMiLCJ0eG5zIiwibWFwIiwicm93IiwidHhuRGF0ZSIsIk1DMDJQZXVsYVRhYUVaIiwiSFRNTDVfRk1UIiwiREFURVRJTUVfTE9DQUxfU0VDT05EUyIsInRvSVNPU3RyaW5nIiwidHlwZSIsIlRyYW5zYWN0aW9uVHlwZXMiLCJOb3JtYWwiLCJpZGVudGlmaWVyIiwiTUMwMkFzbWFodGFNZWtvcml0RVoiLCJwYXJzZUludCIsInVuZGVmaW5lZCIsImRhdGUiLCJwcm9jZXNzZWREYXRlIiwib3JpZ2luYWxBbW91bnQiLCJNQzAyU2NodW1FWiIsIm9yaWdpbmFsQ3VycmVuY3kiLCJTSEVLRUxfQ1VSUkVOQ1kiLCJjaGFyZ2VkQW1vdW50IiwiZGVzY3JpcHRpb24iLCJNQzAyVG51YVRldXJFWiIsInN0YXR1cyIsIlRyYW5zYWN0aW9uU3RhdHVzZXMiLCJDb21wbGV0ZWQiLCJleHRyYWN0UGVuZGluZ1RyYW5zYWN0aW9ucyIsInBlbmRpbmdUeG4iLCJ0cnMiLCJ0ciIsIkFycmF5IiwiZnJvbSIsInF1ZXJ5U2VsZWN0b3JBbGwiLCJ0ZCIsInRleHRDb250ZW50IiwidHhuIiwiYW1vdW50IiwiUGVuZGluZyIsInBvc3RMb2dpbiIsIlByb21pc2UiLCJyYWNlIiwiTWl6cmFoaVNjcmFwZXIiLCJCYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiZ2V0TG9naW5PcHRpb25zIiwibG9naW5VcmwiLCJmaWVsZHMiLCJjaGVja1JlYWRpbmVzcyIsInBvc3RBY3Rpb24iLCJwb3NzaWJsZVJlc3VsdHMiLCJmZXRjaERhdGEiLCIkZXZhbCIsImVsIiwiY2xpY2siLCJudW1PZkFjY291bnRzIiwiJCQiLCJsZW5ndGgiLCJyZXN1bHRzIiwiaSIsInB1c2giLCJmZXRjaEFjY291bnQiLCJzdWNjZXNzIiwiYWNjb3VudHMiLCJlIiwiZXJyb3JUeXBlIiwiU2NyYXBlckVycm9yVHlwZXMiLCJHZW5lcmljIiwiZXJyb3JNZXNzYWdlIiwibWVzc2FnZSIsInJlc3BvbnNlIiwiYW55IiwidXJsIiwid2FpdEZvclJlcXVlc3QiLCJvcHRpb25zIiwiaGVhZGVyIiwiRXJyb3IiLCJtZXNzYWdlcyIsInRleHQiLCJyZWxldmFudFJvd3MiLCJib2R5Iiwicm93cyIsImZpbHRlciIsIlJlY1R5cGVTcGVjaWZpZWQiLCJvc2hUeG4iLCJzdGFydE1vbWVudCIsIm9zaFR4bkFmdGVyU3RhcnREYXRlIiwiaXNTYW1lT3JBZnRlciIsImZyYW1lIiwiZiIsImluY2x1ZGVzIiwiYWxsVHhuIiwiY29uY2F0IiwiYWNjb3VudE51bWJlciIsIkFjY291bnROdW1iZXIiLCJiYWxhbmNlIiwiWWl0cmFMZWxvQ2hla2ltIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7OztBQUFBOztBQUVBOztBQUNBOztBQUdBOztBQUNBOztBQUNBOztBQUdBOztBQUNBOzs7O0FBMEJBLE1BQU1BLGdCQUFnQixHQUFHLG1DQUF6QjtBQUNBLE1BQU1DLFNBQVMsR0FBSSxHQUFFRCxnQkFBaUIsaUNBQXRDO0FBQ0EsTUFBTUUsWUFBWSxHQUFHLG1DQUFyQjtBQUNBLE1BQU1DLG9CQUFvQixHQUFHLHVEQUE3QjtBQUNBLE1BQU1DLFFBQVEsR0FBRyw2QkFBakI7QUFDQSxNQUFNQyxpQkFBaUIsR0FBRyxtQ0FBMUI7QUFDQSxNQUFNQyx5QkFBeUIsR0FBRyxDQUMvQixHQUFFSixZQUFhLHFDQURnQixFQUUvQixHQUFFQSxZQUFhLGdDQUZnQixDQUFsQztBQUlBLE1BQU1LLHlCQUF5QixHQUFHLDZCQUFsQztBQUNBLE1BQU1DLDJCQUEyQixHQUFHLFdBQXBDO0FBQ0EsTUFBTUMsbUJBQW1CLEdBQUcsK0VBQTVCO0FBQ0EsTUFBTUMsV0FBVyxHQUFHLFlBQXBCO0FBQ0EsTUFBTUMsb0JBQW9CLEdBQUcsV0FBN0I7QUFFQSxNQUFNQyxnQkFBZ0IsR0FBRyxr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LGMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgbW9tZW50IGZyb20gJ21vbWVudCc7XG5pbXBvcnQgeyBGcmFtZSwgUGFnZSwgUmVxdWVzdCB9IGZyb20gJ3B1cHBldGVlcic7XG5pbXBvcnQgeyBTSEVLRUxfQ1VSUkVOQ1kgfSBmcm9tICcuLi9jb25zdGFudHMnO1xuaW1wb3J0IHtcbiAgcGFnZUV2YWxBbGwsIHdhaXRVbnRpbEVsZW1lbnREaXNhcHBlYXIsIHdhaXRVbnRpbEVsZW1lbnRGb3VuZCwgd2FpdFVudGlsSWZyYW1lRm91bmQsXG59IGZyb20gJy4uL2hlbHBlcnMvZWxlbWVudHMtaW50ZXJhY3Rpb25zJztcbmltcG9ydCB7IGZldGNoUG9zdFdpdGhpblBhZ2UgfSBmcm9tICcuLi9oZWxwZXJzL2ZldGNoJztcbmltcG9ydCB7IHdhaXRGb3JVcmwgfSBmcm9tICcuLi9oZWxwZXJzL25hdmlnYXRpb24nO1xuaW1wb3J0IHtcbiAgVHJhbnNhY3Rpb24sIFRyYW5zYWN0aW9uc0FjY291bnQsIFRyYW5zYWN0aW9uU3RhdHVzZXMsIFRyYW5zYWN0aW9uVHlwZXMsXG59IGZyb20gJy4uL3RyYW5zYWN0aW9ucyc7XG5pbXBvcnQgeyBTY3JhcGVyQ3JlZGVudGlhbHMsIFNjcmFwZXJFcnJvclR5cGVzIH0gZnJvbSAnLi9iYXNlLXNjcmFwZXInO1xuaW1wb3J0IHsgQmFzZVNjcmFwZXJXaXRoQnJvd3NlciwgTG9naW5SZXN1bHRzLCBQb3NzaWJsZUxvZ2luUmVzdWx0cyB9IGZyb20gJy4vYmFzZS1zY3JhcGVyLXdpdGgtYnJvd3Nlcic7XG5cbmludGVyZmFjZSBTY3JhcGVkVHJhbnNhY3Rpb24ge1xuICBSZWNUeXBlU3BlY2lmaWVkOiBib29sZWFuO1xuICBNQzAyUGV1bGFUYWFFWjogc3RyaW5nO1xuICBNQzAyU2NodW1FWjogbnVtYmVyO1xuICBNQzAyQXNtYWh0YU1la29yaXRFWjogc3RyaW5nO1xuICBNQzAyVG51YVRldXJFWjogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgU2NyYXBlZFRyYW5zYWN0aW9uc1Jlc3VsdCB7XG4gIGhlYWRlcjoge1xuICAgIHN1Y2Nlc3M6IGJvb2xlYW47XG4gICAgbWVzc2FnZXM6IHsgdGV4dDogc3RyaW5nIH1bXTtcbiAgfTtcbiAgYm9keToge1xuICAgIGZpZWxkczoge1xuICAgICAgQWNjb3VudE51bWJlcjogc3RyaW5nO1xuICAgICAgWWl0cmFMZWxvQ2hla2ltOiBzdHJpbmc7XG4gICAgfTtcbiAgICB0YWJsZToge1xuICAgICAgcm93czogU2NyYXBlZFRyYW5zYWN0aW9uW107XG4gICAgfTtcbiAgfTtcbn1cblxuY29uc3QgQkFTRV9XRUJTSVRFX1VSTCA9ICdodHRwczovL3d3dy5taXpyYWhpLXRlZmFob3QuY28uaWwnO1xuY29uc3QgTE9HSU5fVVJMID0gYCR7QkFTRV9XRUJTSVRFX1VSTH0vbG9naW4vaW5kZXguaHRtbCMvYXV0aC1wYWdlLWhlYDtcbmNvbnN0IEJBU0VfQVBQX1VSTCA9ICdodHRwczovL210by5taXpyYWhpLXRlZmFob3QuY28uaWwnO1xuY29uc3QgQUZURVJfTE9HSU5fQkFTRV9VUkwgPSAvaHR0cHM6XFwvXFwvbXRvXFwubWl6cmFoaS10ZWZhaG90XFwuY29cXC5pbFxcL09ubGluZUFwcFxcLy4qLztcbmNvbnN0IE9TSF9QQUdFID0gJy9vc2gvbGVnYWN5L2xlZ2FjeS1Pc2gtTWFpbic7XG5jb25zdCBUUkFOU0FDVElPTlNfUEFHRSA9ICcvb3NoL2xlZ2FjeS9yb290LW1haW4tb3NoLXA0MjhOZXcnO1xuY29uc3QgVFJBTlNBQ1RJT05TX1JFUVVFU1RfVVJMUyA9IFtcbiAgYCR7QkFTRV9BUFBfVVJMfS9PbmxpbmVQaWxvdC9hcGkvU2t5T1NIL2dldDQyOEluZGV4YCxcbiAgYCR7QkFTRV9BUFBfVVJMfS9PbmxpbmUvYXBpL1NreU9TSC9nZXQ0MjhJbmRleGAsXG5dO1xuY29uc3QgUEVORElOR19UUkFOU0FDVElPTlNfUEFHRSA9ICcvb3NoL2xlZ2FjeS9sZWdhY3ktT3NoLXA0MjAnO1xuY29uc3QgUEVORElOR19UUkFOU0FDVElPTlNfSUZSQU1FID0gJ3A0MjAuYXNweCc7XG5jb25zdCBDSEFOR0VfUEFTU1dPUkRfVVJMID0gL2h0dHBzOlxcL1xcL3d3d1xcLm1penJhaGktdGVmYWhvdFxcLmNvXFwuaWxcXC9sb2dpblxcL1xcdytcXC9pbmRleFxcLmh0bWwjXFwvY2hhbmdlLXBhc3MvO1xuY29uc3QgREFURV9GT1JNQVQgPSAnREQvTU0vWVlZWSc7XG5jb25zdCBNQVhfUk9XU19QRVJfUkVRVUVTVCA9IDEwMDAwMDAwMDAwO1xuXG5jb25zdCB1c2VybmFtZVNlbGVjdG9yID0gJyNlbWFpbERlc2t0b3BIZWInO1xuY29uc3QgcGFzc3dvcmRTZWxlY3RvciA9ICcjcGFzc3dvcmRJRERlc2t0b3BIRUInO1xuY29uc3Qgc3VibWl0QnV0dG9uU2VsZWN0b3IgPSAnLmZvcm0tZGVza3RvcCBidXR0b24nO1xuY29uc3QgaW52YWxpZFBhc3N3b3JkU2VsZWN0b3IgPSAnYVtocmVmKj1cImh0dHBzOi8vc2MubWl6cmFoaS10ZWZhaG90LmNvLmlsL1NDU2VydmljZXMvU0MvUDAxMC5hc3B4XCJdJztcbmNvbnN0IGFmdGVyTG9naW5TZWxlY3RvciA9ICcjZHJvcGRvd25CYXNpYyc7XG5jb25zdCBsb2dpblNwaW5uZXJTZWxlY3RvciA9ICdkaXYubmd4LW92ZXJsYXkubG9hZGluZy1mb3JlZ3JvdW5kJztcbmNvbnN0IGFjY291bnREcm9wRG93bkl0ZW1TZWxlY3RvciA9ICcjQWNjb3VudFBpY2tlciAuaXRlbSc7XG5jb25zdCBwZW5kaW5nVHJ4SWRlbnRpZmllcklkID0gJyNjdGwwMF9Db250ZW50UGxhY2VIb2xkZXIyX3BhbmVsMSc7XG5jb25zdCBjaGVja2luZ0FjY291bnRUYWJIZWJyZXdOYW1lID0gJ9ei15XXkdeoINeV16nXkSc7XG5jb25zdCBjaGVja2luZ0FjY291bnRUYWJFbmdsaXNoTmFtZSA9ICdDaGVja2luZyBBY2NvdW50JztcblxuXG5mdW5jdGlvbiBjcmVhdGVMb2dpbkZpZWxkcyhjcmVkZW50aWFsczogU2NyYXBlckNyZWRlbnRpYWxzKSB7XG4gIHJldHVybiBbXG4gICAgeyBzZWxlY3RvcjogdXNlcm5hbWVTZWxlY3RvciwgdmFsdWU6IGNyZWRlbnRpYWxzLnVzZXJuYW1lIH0sXG4gICAgeyBzZWxlY3RvcjogcGFzc3dvcmRTZWxlY3RvciwgdmFsdWU6IGNyZWRlbnRpYWxzLnBhc3N3b3JkIH0sXG4gIF07XG59XG5cbmZ1bmN0aW9uIGdldFBvc3NpYmxlTG9naW5SZXN1bHRzKHBhZ2U6IFBhZ2UpOiBQb3NzaWJsZUxvZ2luUmVzdWx0cyB7XG4gIHJldHVybiB7XG4gICAgW0xvZ2luUmVzdWx0cy5TdWNjZXNzXTogW0FGVEVSX0xPR0lOX0JBU0VfVVJMLCBhc3luYyAoKSA9PiAhIShhd2FpdCBwYWdlLiR4KGAvL2EvL3NwYW5bY29udGFpbnMoLiwgXCIke2NoZWNraW5nQWNjb3VudFRhYkhlYnJld05hbWV9XCIpIG9yIGNvbnRhaW5zKC4sIFwiJHtjaGVja2luZ0FjY291bnRUYWJFbmdsaXNoTmFtZX1cIildYCkpXSxcbiAgICBbTG9naW5SZXN1bHRzLkludmFsaWRQYXNzd29yZF06IFthc3luYyAoKSA9PiAhIShhd2FpdCBwYWdlLiQoaW52YWxpZFBhc3N3b3JkU2VsZWN0b3IpKV0sXG4gICAgW0xvZ2luUmVzdWx0cy5DaGFuZ2VQYXNzd29yZF06IFtDSEFOR0VfUEFTU1dPUkRfVVJMXSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZ2V0U3RhcnRNb21lbnQob3B0aW9uc1N0YXJ0RGF0ZTogRGF0ZSkge1xuICBjb25zdCBkZWZhdWx0U3RhcnRNb21lbnQgPSBtb21lbnQoKS5zdWJ0cmFjdCgxLCAneWVhcnMnKTtcbiAgY29uc3Qgc3RhcnREYXRlID0gb3B0aW9uc1N0YXJ0RGF0ZSB8fCBkZWZhdWx0U3RhcnRNb21lbnQudG9EYXRlKCk7XG4gIHJldHVybiBtb21lbnQubWF4KGRlZmF1bHRTdGFydE1vbWVudCwgbW9tZW50KHN0YXJ0RGF0ZSkpO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVEYXRhRnJvbVJlcXVlc3QocmVxdWVzdDogUmVxdWVzdCwgb3B0aW9uc1N0YXJ0RGF0ZTogRGF0ZSkge1xuICBjb25zdCBkYXRhID0gSlNPTi5wYXJzZShyZXF1ZXN0LnBvc3REYXRhKCkgfHwgJ3t9Jyk7XG5cbiAgZGF0YS5pbkZyb21EYXRlID0gZ2V0U3RhcnRNb21lbnQob3B0aW9uc1N0YXJ0RGF0ZSkuZm9ybWF0KERBVEVfRk9STUFUKTtcbiAgZGF0YS5pblRvRGF0ZSA9IG1vbWVudCgpLmZvcm1hdChEQVRFX0ZPUk1BVCk7XG4gIGRhdGEudGFibGUubWF4Um93ID0gTUFYX1JPV1NfUEVSX1JFUVVFU1Q7XG5cbiAgcmV0dXJuIGRhdGE7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUhlYWRlcnNGcm9tUmVxdWVzdChyZXF1ZXN0OiBSZXF1ZXN0KSB7XG4gIHJldHVybiB7XG4gICAgbWl6cmFoaXhzcmZ0b2tlbjogcmVxdWVzdC5oZWFkZXJzKCkubWl6cmFoaXhzcmZ0b2tlbixcbiAgICAnQ29udGVudC1UeXBlJzogcmVxdWVzdC5oZWFkZXJzKClbJ2NvbnRlbnQtdHlwZSddLFxuICB9O1xufVxuXG5cbmZ1bmN0aW9uIGNvbnZlcnRUcmFuc2FjdGlvbnModHhuczogU2NyYXBlZFRyYW5zYWN0aW9uW10pOiBUcmFuc2FjdGlvbltdIHtcbiAgcmV0dXJuIHR4bnMubWFwKChyb3cpID0+IHtcbiAgICBjb25zdCB0eG5EYXRlID0gbW9tZW50KHJvdy5NQzAyUGV1bGFUYWFFWiwgbW9tZW50LkhUTUw1X0ZNVC5EQVRFVElNRV9MT0NBTF9TRUNPTkRTKVxuICAgICAgLnRvSVNPU3RyaW5nKCk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgdHlwZTogVHJhbnNhY3Rpb25UeXBlcy5Ob3JtYWwsXG4gICAgICBpZGVudGlmaWVyOiByb3cuTUMwMkFzbWFodGFNZWtvcml0RVogPyBwYXJzZUludChyb3cuTUMwMkFzbWFodGFNZWtvcml0RVosIDEwKSA6IHVuZGVmaW5lZCxcbiAgICAgIGRhdGU6IHR4bkRhdGUsXG4gICAgICBwcm9jZXNzZWREYXRlOiB0eG5EYXRlLFxuICAgICAgb3JpZ2luYWxBbW91bnQ6IHJvdy5NQzAyU2NodW1FWixcbiAgICAgIG9yaWdpbmFsQ3VycmVuY3k6IFNIRUtFTF9DVVJSRU5DWSxcbiAgICAgIGNoYXJnZWRBbW91bnQ6IHJvdy5NQzAyU2NodW1FWixcbiAgICAgIGRlc2NyaXB0aW9uOiByb3cuTUMwMlRudWFUZXVyRVosXG4gICAgICBzdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMuQ29tcGxldGVkLFxuICAgIH07XG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBleHRyYWN0UGVuZGluZ1RyYW5zYWN0aW9ucyhwYWdlOiBGcmFtZSk6IFByb21pc2U8VHJhbnNhY3Rpb25bXT4ge1xuICBjb25zdCBwZW5kaW5nVHhuID0gYXdhaXQgcGFnZUV2YWxBbGwocGFnZSwgJ3RyLnJnUm93JywgW10sICh0cnMpID0+IHtcbiAgICByZXR1cm4gdHJzLm1hcCgodHIpID0+IEFycmF5LmZyb20odHIucXVlcnlTZWxlY3RvckFsbCgndGQnKSwgKHRkOiBIVE1MVGFibGVEYXRhQ2VsbEVsZW1lbnQpID0+IHRkLnRleHRDb250ZW50IHx8ICcnKSk7XG4gIH0pO1xuXG4gIHJldHVybiBwZW5kaW5nVHhuLm1hcCgodHhuKSA9PiB7XG4gICAgY29uc3QgZGF0ZSA9IG1vbWVudCh0eG5bMF0sICdERC9NTS9ZWScpLnRvSVNPU3RyaW5nKCk7XG4gICAgY29uc3QgYW1vdW50ID0gcGFyc2VJbnQodHhuWzNdLCAxMCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGU6IFRyYW5zYWN0aW9uVHlwZXMuTm9ybWFsLFxuICAgICAgZGF0ZSxcbiAgICAgIHByb2Nlc3NlZERhdGU6IGRhdGUsXG4gICAgICBvcmlnaW5hbEFtb3VudDogYW1vdW50LFxuICAgICAgb3JpZ2luYWxDdXJyZW5jeTogU0hFS0VMX0NVUlJFTkNZLFxuICAgICAgY2hhcmdlZEFtb3VudDogYW1vdW50LFxuICAgICAgZGVzY3JpcHRpb246IHR4blsxXSxcbiAgICAgIHN0YXR1czogVHJhbnNhY3Rpb25TdGF0dXNlcy5QZW5kaW5nLFxuICAgIH07XG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBwb3N0TG9naW4ocGFnZTogUGFnZSkge1xuICBhd2FpdCBQcm9taXNlLnJhY2UoW1xuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBhZnRlckxvZ2luU2VsZWN0b3IpLFxuICAgIHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBpbnZhbGlkUGFzc3dvcmRTZWxlY3RvciksXG4gICAgd2FpdEZvclVybChwYWdlLCBDSEFOR0VfUEFTU1dPUkRfVVJMKSxcbiAgXSk7XG59XG5cbmNsYXNzIE1penJhaGlTY3JhcGVyIGV4dGVuZHMgQmFzZVNjcmFwZXJXaXRoQnJvd3NlciB7XG4gIGdldExvZ2luT3B0aW9ucyhjcmVkZW50aWFsczogU2NyYXBlckNyZWRlbnRpYWxzKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGxvZ2luVXJsOiBMT0dJTl9VUkwsXG4gICAgICBmaWVsZHM6IGNyZWF0ZUxvZ2luRmllbGRzKGNyZWRlbnRpYWxzKSxcbiAgICAgIHN1Ym1pdEJ1dHRvblNlbGVjdG9yLFxuICAgICAgY2hlY2tSZWFkaW5lc3M6IGFzeW5jICgpID0+IHdhaXRVbnRpbEVsZW1lbnREaXNhcHBlYXIodGhpcy5wYWdlLCBsb2dpblNwaW5uZXJTZWxlY3RvciksXG4gICAgICBwb3N0QWN0aW9uOiBhc3luYyAoKSA9PiBwb3N0TG9naW4odGhpcy5wYWdlKSxcbiAgICAgIHBvc3NpYmxlUmVzdWx0czogZ2V0UG9zc2libGVMb2dpblJlc3VsdHModGhpcy5wYWdlKSxcbiAgICB9O1xuICB9XG5cbiAgYXN5bmMgZmV0Y2hEYXRhKCkge1xuICAgIGF3YWl0IHRoaXMucGFnZS4kZXZhbCgnI2Ryb3Bkb3duQmFzaWMsIC5pdGVtJywgKGVsKSA9PiAoZWwgYXMgSFRNTEVsZW1lbnQpLmNsaWNrKCkpO1xuXG4gICAgY29uc3QgbnVtT2ZBY2NvdW50cyA9IChhd2FpdCB0aGlzLnBhZ2UuJCQoYWNjb3VudERyb3BEb3duSXRlbVNlbGVjdG9yKSkubGVuZ3RoO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdHM6IFRyYW5zYWN0aW9uc0FjY291bnRbXSA9IFtdO1xuXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG51bU9mQWNjb3VudHM7IGkgKz0gMSkge1xuICAgICAgICBpZiAoaSA+IDApIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBhZ2UuJGV2YWwoJyNkcm9wZG93bkJhc2ljLCAuaXRlbScsIChlbCkgPT4gKGVsIGFzIEhUTUxFbGVtZW50KS5jbGljaygpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMucGFnZS4kZXZhbChgJHthY2NvdW50RHJvcERvd25JdGVtU2VsZWN0b3J9Om50aC1jaGlsZCgke2kgKyAxfSlgLCAoZWwpID0+IChlbCBhcyBIVE1MRWxlbWVudCkuY2xpY2soKSk7XG4gICAgICAgIHJlc3VsdHMucHVzaCgoYXdhaXQgdGhpcy5mZXRjaEFjY291bnQoKSkpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICBhY2NvdW50czogcmVzdWx0cyxcbiAgICAgIH07XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGVycm9yVHlwZTogU2NyYXBlckVycm9yVHlwZXMuR2VuZXJpYyxcbiAgICAgICAgZXJyb3JNZXNzYWdlOiBlLm1lc3NhZ2UsXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZmV0Y2hBY2NvdW50KCkge1xuICAgIGF3YWl0IHRoaXMucGFnZS4kZXZhbChgYVtocmVmKj1cIiR7T1NIX1BBR0V9XCJdYCwgKGVsKSA9PiAoZWwgYXMgSFRNTEVsZW1lbnQpLmNsaWNrKCkpO1xuICAgIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZCh0aGlzLnBhZ2UsIGBhW2hyZWYqPVwiJHtUUkFOU0FDVElPTlNfUEFHRX1cIl1gKTtcbiAgICBhd2FpdCB0aGlzLnBhZ2UuJGV2YWwoYGFbaHJlZio9XCIke1RSQU5TQUNUSU9OU19QQUdFfVwiXWAsIChlbCkgPT4gKGVsIGFzIEhUTUxFbGVtZW50KS5jbGljaygpKTtcblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgUHJvbWlzZS5hbnkoVFJBTlNBQ1RJT05TX1JFUVVFU1RfVVJMUy5tYXAoYXN5bmMgKHVybCkgPT4ge1xuICAgICAgY29uc3QgcmVxdWVzdCA9IGF3YWl0IHRoaXMucGFnZS53YWl0Rm9yUmVxdWVzdCh1cmwpO1xuICAgICAgY29uc3QgZGF0YSA9IGNyZWF0ZURhdGFGcm9tUmVxdWVzdChyZXF1ZXN0LCB0aGlzLm9wdGlvbnMuc3RhcnREYXRlKTtcbiAgICAgIGNvbnN0IGhlYWRlcnMgPSBjcmVhdGVIZWFkZXJzRnJvbVJlcXVlc3QocmVxdWVzdCk7XG5cbiAgICAgIHJldHVybiBmZXRjaFBvc3RXaXRoaW5QYWdlPFNjcmFwZWRUcmFuc2FjdGlvbnNSZXN1bHQ+KHRoaXMucGFnZSwgdXJsLCBkYXRhLCBoZWFkZXJzKTtcbiAgICB9KSk7XG5cblxuICAgIGlmICghcmVzcG9uc2UgfHwgcmVzcG9uc2UuaGVhZGVyLnN1Y2Nlc3MgPT09IGZhbHNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEVycm9yIGZldGNoaW5nIHRyYW5zYWN0aW9uLiBSZXNwb25zZSBtZXNzYWdlOiAke3Jlc3BvbnNlID8gcmVzcG9uc2UuaGVhZGVyLm1lc3NhZ2VzWzBdLnRleHQgOiAnJ31gKTtcbiAgICB9XG5cbiAgICBjb25zdCByZWxldmFudFJvd3MgPSByZXNwb25zZS5ib2R5LnRhYmxlLnJvd3MuZmlsdGVyKChyb3cpID0+IHJvdy5SZWNUeXBlU3BlY2lmaWVkKTtcbiAgICBjb25zdCBvc2hUeG4gPSBjb252ZXJ0VHJhbnNhY3Rpb25zKHJlbGV2YW50Um93cyk7XG5cbiAgICAvLyB3b3JrYXJvdW5kIGZvciBhIGJ1ZyB3aGljaCB0aGUgYmFuaydzIEFQSSByZXR1cm5zIHRyYW5zYWN0aW9ucyBiZWZvcmUgdGhlIHJlcXVlc3RlZCBzdGFydCBkYXRlXG4gICAgY29uc3Qgc3RhcnRNb21lbnQgPSBnZXRTdGFydE1vbWVudCh0aGlzLm9wdGlvbnMuc3RhcnREYXRlKTtcbiAgICBjb25zdCBvc2hUeG5BZnRlclN0YXJ0RGF0ZSA9IG9zaFR4bi5maWx0ZXIoKHR4bikgPT4gbW9tZW50KHR4bi5kYXRlKS5pc1NhbWVPckFmdGVyKHN0YXJ0TW9tZW50KSk7XG5cbiAgICBhd2FpdCB0aGlzLnBhZ2UuJGV2YWwoYGFbaHJlZio9XCIke1BFTkRJTkdfVFJBTlNBQ1RJT05TX1BBR0V9XCJdYCwgKGVsKSA9PiAoZWwgYXMgSFRNTEVsZW1lbnQpLmNsaWNrKCkpO1xuICAgIGNvbnN0IGZyYW1lID0gYXdhaXQgd2FpdFVudGlsSWZyYW1lRm91bmQodGhpcy5wYWdlLCAoZikgPT4gZi51cmwoKS5pbmNsdWRlcyhQRU5ESU5HX1RSQU5TQUNUSU9OU19JRlJBTUUpKTtcbiAgICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQoZnJhbWUsIHBlbmRpbmdUcnhJZGVudGlmaWVySWQpO1xuICAgIGNvbnN0IHBlbmRpbmdUeG4gPSBhd2FpdCBleHRyYWN0UGVuZGluZ1RyYW5zYWN0aW9ucyhmcmFtZSk7XG5cbiAgICBjb25zdCBhbGxUeG4gPSBvc2hUeG5BZnRlclN0YXJ0RGF0ZS5jb25jYXQocGVuZGluZ1R4bik7XG5cbiAgICByZXR1cm4ge1xuICAgICAgYWNjb3VudE51bWJlcjogcmVzcG9uc2UuYm9keS5maWVsZHMuQWNjb3VudE51bWJlcixcbiAgICAgIHR4bnM6IGFsbFR4bixcbiAgICAgIGJhbGFuY2U6ICtyZXNwb25zZS5ib2R5LmZpZWxkcy5ZaXRyYUxlbG9DaGVraW0sXG4gICAgfTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBNaXpyYWhpU2NyYXBlcjtcbiJdfQ==