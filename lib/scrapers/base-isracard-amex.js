"use strict";

require("core-js/modules/es.array.iterator");

require("core-js/modules/es.promise");

require("core-js/modules/es.string.trim");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _lodash = _interopRequireDefault(require("lodash"));

var _buildUrl = _interopRequireDefault(require("build-url"));

var _moment = _interopRequireDefault(require("moment"));

var _baseScraperWithBrowser = require("./base-scraper-with-browser");

var _fetch = require("../helpers/fetch");

var _constants = require("../constants");

var _dates = _interopRequireDefault(require("../helpers/dates"));

var _transactions = require("../helpers/transactions");

var _transactions2 = require("../transactions");

var _baseScraper = require("./base-scraper");

var _debug = require("../helpers/debug");

var _waiting = require("../helpers/waiting");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys(Object(source), true).forEach(function (key) { _defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const COUNTRY_CODE = '212';
const ID_TYPE = '1';
const INSTALLMENTS_KEYWORD = 'תשלום';
const DATE_FORMAT = 'DD/MM/YYYY';
const debug = (0, _debug.getDebug)('base-isracard-amex');

function getAccountsUrl(servicesUrl, monthMoment) {
  const billingDate = monthMoment.format('YYYY-MM-DD');
  return (0, _buildUrl.default)(servicesUrl, {
    queryParams: {
      reqName: 'DashboardMonth',
      actionCode: '0',
      billingDate,
      format: 'Json'
    }
  });
}

async function fetchAccounts(page, servicesUrl, monthMoment) {
  const dataUrl = getAccountsUrl(servicesUrl, monthMoment);
  const dataResult = await (0, _fetch.fetchGetWithinPage)(page, dataUrl);

  if (dataResult && _lodash.default.get(dataResult, 'Header.Status') === '1' && dataResult.DashboardMonthBean) {
    const {
      cardsCharges
    } = dataResult.DashboardMonthBean;

    if (cardsCharges) {
      return cardsCharges.map(cardCharge => {
        return {
          index: parseInt(cardCharge.cardIndex, 10),
          accountNumber: cardCharge.cardNumber,
          processedDate: (0, _moment.default)(cardCharge.billingDate, DATE_FORMAT).toISOString()
        };
      });
    }
  }

  return [];
}

function getTransactionsUrl(servicesUrl, monthMoment) {
  const month = monthMoment.month() + 1;
  const year = monthMoment.year();
  const monthStr = month < 10 ? `0${month}` : month.toString();
  return (0, _buildUrl.default)(servicesUrl, {
    queryParams: {
      reqName: 'CardsTransactionsList',
      month: monthStr,
      year: `${year}`,
      requiredDate: 'N'
    }
  });
}

function convertCurrency(currencyStr) {
  if (currencyStr === _constants.SHEKEL_CURRENCY_KEYWORD || currencyStr === _constants.ALT_SHEKEL_CURRENCY) {
    return _constants.SHEKEL_CURRENCY;
  }

  return currencyStr;
}

function getInstallmentsInfo(txn) {
  if (!txn.moreInfo || !txn.moreInfo.includes(INSTALLMENTS_KEYWORD)) {
    return undefined;
  }

  const matches = txn.moreInfo.match(/\d+/g);

  if (!matches || matches.length < 2) {
    return undefined;
  }

  return {
    number: parseInt(matches[0], 10),
    total: parseInt(matches[1], 10)
  };
}

function getTransactionType(txn) {
  return getInstallmentsInfo(txn) ? _transactions2.TransactionTypes.Installments : _transactions2.TransactionTypes.Normal;
}

function convertTransactions(txns, processedDate) {
  const filteredTxns = txns.filter(txn => txn.dealSumType !== '1' && txn.voucherNumberRatz !== '000000000' && txn.voucherNumberRatzOutbound !== '000000000');
  return filteredTxns.map(txn => {
    const isOutbound = txn.dealSumOutbound;
    const txnDateStr = isOutbound ? txn.fullPurchaseDateOutbound : txn.fullPurchaseDate;
    const txnMoment = (0, _moment.default)(txnDateStr, DATE_FORMAT);
    const currentProcessedDate = txn.fullPaymentDate ? (0, _moment.default)(txn.fullPaymentDate, DATE_FORMAT).toISOString() : processedDate;
    const result = {
      type: getTransactionType(txn),
      identifier: parseInt(isOutbound ? txn.voucherNumberRatzOutbound : txn.voucherNumberRatz, 10),
      date: txnMoment.toISOString(),
      processedDate: currentProcessedDate,
      originalAmount: isOutbound ? -txn.dealSumOutbound : -txn.dealSum,
      originalCurrency: convertCurrency(txn.currencyId),
      chargedAmount: isOutbound ? -txn.paymentSumOutbound : -txn.paymentSum,
      description: isOutbound ? txn.fullSupplierNameOutbound : txn.fullSupplierNameHeb,
      memo: txn.moreInfo || '',
      installments: getInstallmentsInfo(txn) || undefined,
      status: _transactions2.TransactionStatuses.Completed
    };
    return result;
  });
}

async function fetchTransactions(page, options, startMoment, monthMoment) {
  const accounts = await fetchAccounts(page, options.servicesUrl, monthMoment);
  const dataUrl = getTransactionsUrl(options.servicesUrl, monthMoment);
  const dataResult = await (0, _fetch.fetchGetWithinPage)(page, dataUrl);

  if (dataResult && _lodash.default.get(dataResult, 'Header.Status') === '1' && dataResult.CardsTransactionsListBean) {
    const accountTxns = {};
    accounts.forEach(account => {
      const txnGroups = _lodash.default.get(dataResult, `CardsTransactionsListBean.Index${account.index}.CurrentCardTransactions`);

      if (txnGroups) {
        var _options$outputData$e, _options$outputData;

        let allTxns = [];
        txnGroups.forEach(txnGroup => {
          if (txnGroup.txnIsrael) {
            const txns = convertTransactions(txnGroup.txnIsrael, account.processedDate);
            allTxns.push(...txns);
          }

          if (txnGroup.txnAbroad) {
            const txns = convertTransactions(txnGroup.txnAbroad, account.processedDate);
            allTxns.push(...txns);
          }
        });

        if (!options.combineInstallments) {
          allTxns = (0, _transactions.fixInstallments)(allTxns);
        }

        if ((_options$outputData$e = (_options$outputData = options.outputData) === null || _options$outputData === void 0 ? void 0 : _options$outputData.enableTransactionsFilterByDate) !== null && _options$outputData$e !== void 0 ? _options$outputData$e : true) {
          allTxns = (0, _transactions.filterOldTransactions)(allTxns, startMoment, options.combineInstallments || false);
        }

        accountTxns[account.accountNumber] = {
          accountNumber: account.accountNumber,
          index: account.index,
          txns: allTxns
        };
      }
    });
    return accountTxns;
  }

  return {};
}

function getTransactionExtraDetails(servicesUrl, month, accountIndex, transaction) {
  const moedChiuv = month.format('MMYYYY');
  return (0, _buildUrl.default)(servicesUrl, {
    queryParams: {
      reqName: 'PirteyIska_204',
      CardIndex: accountIndex.toString(),
      shovarRatz: transaction.identifier.toString(),
      moedChiuv
    }
  });
}

async function getExtraScrapTransaction(page, options, month, accountIndex, transaction) {
  const dataUrl = getTransactionExtraDetails(options.servicesUrl, month, accountIndex, transaction);
  const data = await (0, _fetch.fetchGetWithinPage)(page, dataUrl);

  const rawCategory = _lodash.default.get(data, 'PirteyIska_204Bean.sector');

  return _objectSpread({}, transaction, {
    category: rawCategory.trim()
  });
}

function getExtraScrapTransactions(accountWithIndex, page, options, month) {
  const promises = accountWithIndex.txns.map(t => getExtraScrapTransaction(page, options, month, accountWithIndex.index, t));
  return Promise.all(promises);
}

async function getExtraScrapAccount(page, options, accountMap, month) {
  const promises = Object.keys(accountMap).map(async a => _objectSpread({}, accountMap[a], {
    txns: await getExtraScrapTransactions(accountMap[a], page, options, month)
  }));
  const accounts = await Promise.all(promises);
  return accounts.reduce((m, x) => _objectSpread({}, m, {
    [x.accountNumber]: x
  }), {});
}

function getExtraScrap(accountsWithIndex, page, options, allMonths) {
  const actions = accountsWithIndex.map((a, i) => () => getExtraScrapAccount(page, options, a, allMonths[i]));
  return (0, _waiting.runSerial)(actions);
}

async function fetchAllTransactions(page, options, startMoment) {
  var _options$futureMonths;

  const futureMonthsToScrape = (_options$futureMonths = options.futureMonthsToScrape) !== null && _options$futureMonths !== void 0 ? _options$futureMonths : 1;
  const allMonths = (0, _dates.default)(startMoment, futureMonthsToScrape);
  const results = await Promise.all(allMonths.map(async monthMoment => {
    return fetchTransactions(page, options, startMoment, monthMoment);
  }));
  const finalResult = options.additionalTransactionInformation ? await getExtraScrap(results, page, options, allMonths) : results;
  const combinedTxns = {};
  finalResult.forEach(result => {
    Object.keys(result).forEach(accountNumber => {
      let txnsForAccount = combinedTxns[accountNumber];

      if (!txnsForAccount) {
        txnsForAccount = [];
        combinedTxns[accountNumber] = txnsForAccount;
      }

      const toBeAddedTxns = result[accountNumber].txns;
      combinedTxns[accountNumber].push(...toBeAddedTxns);
    });
  });
  const accounts = Object.keys(combinedTxns).map(accountNumber => {
    return {
      accountNumber,
      txns: combinedTxns[accountNumber]
    };
  });
  return {
    success: true,
    accounts
  };
}

class IsracardAmexBaseScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  constructor(options, baseUrl, companyCode) {
    super(options);

    _defineProperty(this, "baseUrl", void 0);

    _defineProperty(this, "companyCode", void 0);

    _defineProperty(this, "servicesUrl", void 0);

    this.baseUrl = baseUrl;
    this.companyCode = companyCode;
    this.servicesUrl = `${baseUrl}/services/ProxyRequestHandler.ashx`;
  }

  async login(credentials) {
    await this.page.setRequestInterception(true);
    this.page.on('request', request => {
      if (request.url().includes('detector-dom.min.js')) {
        debug('force abort for request do download detector-dom.min.js resource');
        request.abort();
      } else {
        request.continue();
      }
    });
    debug('navigate to login page');
    await this.navigateTo(`${this.baseUrl}/personalarea/Login`);
    this.emitProgress(_baseScraper.ScaperProgressTypes.LoggingIn);
    const validateUrl = `${this.servicesUrl}?reqName=ValidateIdData`;
    const validateRequest = {
      id: credentials.id,
      cardSuffix: credentials.card6Digits,
      countryCode: COUNTRY_CODE,
      idType: ID_TYPE,
      checkLevel: '1',
      companyCode: this.companyCode
    };
    const validateResult = await (0, _fetch.fetchPostWithinPage)(this.page, validateUrl, validateRequest);

    if (!validateResult || !validateResult.Header || validateResult.Header.Status !== '1' || !validateResult.ValidateIdDataBean) {
      throw new Error('unknown error during login');
    }

    const validateReturnCode = validateResult.ValidateIdDataBean.returnCode;
    debug(`user validate with return code '${validateReturnCode}'`);

    if (validateReturnCode === '1') {
      const {
        userName
      } = validateResult.ValidateIdDataBean;
      const loginUrl = `${this.servicesUrl}?reqName=performLogonI`;
      const request = {
        KodMishtamesh: userName,
        MisparZihuy: credentials.id,
        Sisma: credentials.password,
        cardSuffix: credentials.card6Digits,
        countryCode: COUNTRY_CODE,
        idType: ID_TYPE
      };
      const loginResult = await (0, _fetch.fetchPostWithinPage)(this.page, loginUrl, request);
      debug(`user login with status '${loginResult === null || loginResult === void 0 ? void 0 : loginResult.status}'`);

      if (loginResult && loginResult.status === '1') {
        this.emitProgress(_baseScraper.ScaperProgressTypes.LoginSuccess);
        return {
          success: true
        };
      }

      if (loginResult && loginResult.status === '3') {
        this.emitProgress(_baseScraper.ScaperProgressTypes.ChangePassword);
        return {
          success: false,
          errorType: _baseScraper.ScraperErrorTypes.ChangePassword
        };
      }

      this.emitProgress(_baseScraper.ScaperProgressTypes.LoginFailed);
      return {
        success: false,
        errorType: _baseScraper.ScraperErrorTypes.InvalidPassword
      };
    }

    if (validateReturnCode === '4') {
      this.emitProgress(_baseScraper.ScaperProgressTypes.ChangePassword);
      return {
        success: false,
        errorType: _baseScraper.ScraperErrorTypes.ChangePassword
      };
    }

    this.emitProgress(_baseScraper.ScaperProgressTypes.LoginFailed);
    return {
      success: false,
      errorType: _baseScraper.ScraperErrorTypes.InvalidPassword
    };
  }

  async fetchData() {
    const defaultStartMoment = (0, _moment.default)().subtract(1, 'years');
    const startDate = this.options.startDate || defaultStartMoment.toDate();

    const startMoment = _moment.default.max(defaultStartMoment, (0, _moment.default)(startDate));

    return fetchAllTransactions(this.page, _objectSpread({}, this.options, {
      servicesUrl: this.servicesUrl,
      companyCode: this.companyCode
    }), startMoment);
  }

}

var _default = IsracardAmexBaseScraper;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zY3JhcGVycy9iYXNlLWlzcmFjYXJkLWFtZXgudHMiXSwibmFtZXMiOlsiQ09VTlRSWV9DT0RFIiwiSURfVFlQRSIsIklOU1RBTExNRU5UU19LRVlXT1JEIiwiREFURV9GT1JNQVQiLCJkZWJ1ZyIsImdldEFjY291bnRzVXJsIiwic2VydmljZXNVcmwiLCJtb250aE1vbWVudCIsImJpbGxpbmdEYXRlIiwiZm9ybWF0IiwicXVlcnlQYXJhbXMiLCJyZXFOYW1lIiwiYWN0aW9uQ29kZSIsImZldGNoQWNjb3VudHMiLCJwYWdlIiwiZGF0YVVybCIsImRhdGFSZXN1bHQiLCJfIiwiZ2V0IiwiRGFzaGJvYXJkTW9udGhCZWFuIiwiY2FyZHNDaGFyZ2VzIiwibWFwIiwiY2FyZENoYXJnZSIsImluZGV4IiwicGFyc2VJbnQiLCJjYXJkSW5kZXgiLCJhY2NvdW50TnVtYmVyIiwiY2FyZE51bWJlciIsInByb2Nlc3NlZERhdGUiLCJ0b0lTT1N0cmluZyIsImdldFRyYW5zYWN0aW9uc1VybCIsIm1vbnRoIiwieWVhciIsIm1vbnRoU3RyIiwidG9TdHJpbmciLCJyZXF1aXJlZERhdGUiLCJjb252ZXJ0Q3VycmVuY3kiLCJjdXJyZW5jeVN0ciIsIlNIRUtFTF9DVVJSRU5DWV9LRVlXT1JEIiwiQUxUX1NIRUtFTF9DVVJSRU5DWSIsIlNIRUtFTF9DVVJSRU5DWSIsImdldEluc3RhbGxtZW50c0luZm8iLCJ0eG4iLCJtb3JlSW5mbyIsImluY2x1ZGVzIiwidW5kZWZpbmVkIiwibWF0Y2hlcyIsIm1hdGNoIiwibGVuZ3RoIiwibnVtYmVyIiwidG90YWwiLCJnZXRUcmFuc2FjdGlvblR5cGUiLCJUcmFuc2FjdGlvblR5cGVzIiwiSW5zdGFsbG1lbnRzIiwiTm9ybWFsIiwiY29udmVydFRyYW5zYWN0aW9ucyIsInR4bnMiLCJmaWx0ZXJlZFR4bnMiLCJmaWx0ZXIiLCJkZWFsU3VtVHlwZSIsInZvdWNoZXJOdW1iZXJSYXR6Iiwidm91Y2hlck51bWJlclJhdHpPdXRib3VuZCIsImlzT3V0Ym91bmQiLCJkZWFsU3VtT3V0Ym91bmQiLCJ0eG5EYXRlU3RyIiwiZnVsbFB1cmNoYXNlRGF0ZU91dGJvdW5kIiwiZnVsbFB1cmNoYXNlRGF0ZSIsInR4bk1vbWVudCIsImN1cnJlbnRQcm9jZXNzZWREYXRlIiwiZnVsbFBheW1lbnREYXRlIiwicmVzdWx0IiwidHlwZSIsImlkZW50aWZpZXIiLCJkYXRlIiwib3JpZ2luYWxBbW91bnQiLCJkZWFsU3VtIiwib3JpZ2luYWxDdXJyZW5jeSIsImN1cnJlbmN5SWQiLCJjaGFyZ2VkQW1vdW50IiwicGF5bWVudFN1bU91dGJvdW5kIiwicGF5bWVudFN1bSIsImRlc2NyaXB0aW9uIiwiZnVsbFN1cHBsaWVyTmFtZU91dGJvdW5kIiwiZnVsbFN1cHBsaWVyTmFtZUhlYiIsIm1lbW8iLCJpbnN0YWxsbWVudHMiLCJzdGF0dXMiLCJUcmFuc2FjdGlvblN0YXR1c2VzIiwiQ29tcGxldGVkIiwiZmV0Y2hUcmFuc2FjdGlvbnMiLCJvcHRpb25zIiwic3RhcnRNb21lbnQiLCJhY2NvdW50cyIsIkNhcmRzVHJhbnNhY3Rpb25zTGlzdEJlYW4iLCJhY2NvdW50VHhucyIsImZvckVhY2giLCJhY2NvdW50IiwidHhuR3JvdXBzIiwiYWxsVHhucyIsInR4bkdyb3VwIiwidHhuSXNyYWVsIiwicHVzaCIsInR4bkFicm9hZCIsImNvbWJpbmVJbnN0YWxsbWVudHMiLCJvdXRwdXREYXRhIiwiZW5hYmxlVHJhbnNhY3Rpb25zRmlsdGVyQnlEYXRlIiwiZ2V0VHJhbnNhY3Rpb25FeHRyYURldGFpbHMiLCJhY2NvdW50SW5kZXgiLCJ0cmFuc2FjdGlvbiIsIm1vZWRDaGl1diIsIkNhcmRJbmRleCIsInNob3ZhclJhdHoiLCJnZXRFeHRyYVNjcmFwVHJhbnNhY3Rpb24iLCJkYXRhIiwicmF3Q2F0ZWdvcnkiLCJjYXRlZ29yeSIsInRyaW0iLCJnZXRFeHRyYVNjcmFwVHJhbnNhY3Rpb25zIiwiYWNjb3VudFdpdGhJbmRleCIsInByb21pc2VzIiwidCIsIlByb21pc2UiLCJhbGwiLCJnZXRFeHRyYVNjcmFwQWNjb3VudCIsImFjY291bnRNYXAiLCJPYmplY3QiLCJrZXlzIiwiYSIsInJlZHVjZSIsIm0iLCJ4IiwiZ2V0RXh0cmFTY3JhcCIsImFjY291bnRzV2l0aEluZGV4IiwiYWxsTW9udGhzIiwiYWN0aW9ucyIsImkiLCJmZXRjaEFsbFRyYW5zYWN0aW9ucyIsImZ1dHVyZU1vbnRoc1RvU2NyYXBlIiwicmVzdWx0cyIsImZpbmFsUmVzdWx0IiwiYWRkaXRpb25hbFRyYW5zYWN0aW9uSW5mb3JtYXRpb24iLCJjb21iaW5lZFR4bnMiLCJ0eG5zRm9yQWNjb3VudCIsInRvQmVBZGRlZFR4bnMiLCJzdWNjZXNzIiwiSXNyYWNhcmRBbWV4QmFzZVNjcmFwZXIiLCJCYXNlU2NyYXBlcldpdGhCcm93c2VyIiwiY29uc3RydWN0b3IiLCJiYXNlVXJsIiwiY29tcGFueUNvZGUiLCJsb2dpbiIsImNyZWRlbnRpYWxzIiwic2V0UmVxdWVzdEludGVyY2VwdGlvbiIsIm9uIiwicmVxdWVzdCIsInVybCIsImFib3J0IiwiY29udGludWUiLCJuYXZpZ2F0ZVRvIiwiZW1pdFByb2dyZXNzIiwiU2NhcGVyUHJvZ3Jlc3NUeXBlcyIsIkxvZ2dpbmdJbiIsInZhbGlkYXRlVXJsIiwidmFsaWRhdGVSZXF1ZXN0IiwiaWQiLCJjYXJkU3VmZml4IiwiY2FyZDZEaWdpdHMiLCJjb3VudHJ5Q29kZSIsImlkVHlwZSIsImNoZWNrTGV2ZWwiLCJ2YWxpZGF0ZVJlc3VsdCIsIkhlYWRlciIsIlN0YXR1cyIsIlZhbGlkYXRlSWREYXRhQmVhbiIsIkVycm9yIiwidmFsaWRhdGVSZXR1cm5Db2RlIiwicmV0dXJuQ29kZSIsInVzZXJOYW1lIiwibG9naW5VcmwiLCJLb2RNaXNodGFtZXNoIiwiTWlzcGFyWmlodXkiLCJTaXNtYSIsInBhc3N3b3JkIiwibG9naW5SZXN1bHQiLCJMb2dpblN1Y2Nlc3MiLCJDaGFuZ2VQYXNzd29yZCIsImVycm9yVHlwZSIsIlNjcmFwZXJFcnJvclR5cGVzIiwiTG9naW5GYWlsZWQiLCJJbnZhbGlkUGFzc3dvcmQiLCJmZXRjaERhdGEiLCJkZWZhdWx0U3RhcnRNb21lbnQiLCJzdWJ0cmFjdCIsInN0YXJ0RGF0ZSIsInRvRGF0ZSIsIm1vbWVudCIsIm1heCJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7OztBQUFBOztBQUNBOztBQUNBOztBQUdBOztBQUNBOztBQUNBOztBQUtBOztBQUNBOztBQUNBOztBQUlBOztBQUtBOztBQUNBOzs7Ozs7Ozs7O0FBRUEsTUFBTUEsWUFBWSxHQUFHLEtBQXJCO0FBQ0EsTUFBTUMsT0FBTyxHQUFHLEdBQWhCO0FBQ0EsTUFBTUMsb0JBQW9CLEdBQUcsT0FBN0I7QUFFQSxNQUFNQyxXQUFXLEdBQUcsWUFBcEI7QUFFQSxNQUFNQyxLQUFLLEdBQUcscUJBQVMsb0JBQVQsQ0FBZDs7QUFzRUEsU0FBU0MsY0FBVCxDQUF3QkMsV0FBeEIsRUFBNkNDLFdBQTdDLEVBQWtFO0FBQ2hFLFFBQU1DLFdBQVcsR0FBR0QsV0FBVyxDQUFDRSxNQUFaLENBQW1CLFlBQW5CLENBQXBCO0FBQ0EsU0FBTyx1QkFBU0gsV0FBVCxFQUFzQjtBQUMzQkksSUFBQUEsV0FBVyxFQUFFO0FBQ1hDLE1BQUFBLE9BQU8sRUFBRSxnQkFERTtBQUVYQyxNQUFBQSxVQUFVLEVBQUUsR0FGRDtBQUdYSixNQUFBQSxXQUhXO0FBSVhDLE1BQUFBLE1BQU0sRUFBRTtBQUpHO0FBRGMsR0FBdEIsQ0FBUDtBQVFEOztBQUVELGVBQWVJLGFBQWYsQ0FBNkJDLElBQTdCLEVBQXlDUixXQUF6QyxFQUE4REMsV0FBOUQsRUFBOEc7QUFDNUcsUUFBTVEsT0FBTyxHQUFHVixjQUFjLENBQUNDLFdBQUQsRUFBY0MsV0FBZCxDQUE5QjtBQUNBLFFBQU1TLFVBQVUsR0FBRyxNQUFNLCtCQUFzREYsSUFBdEQsRUFBNERDLE9BQTVELENBQXpCOztBQUNBLE1BQUlDLFVBQVUsSUFBSUMsZ0JBQUVDLEdBQUYsQ0FBTUYsVUFBTixFQUFrQixlQUFsQixNQUF1QyxHQUFyRCxJQUE0REEsVUFBVSxD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QU8sRUFBRSxLQURKO0FBRUwwQyxRQUFBQSxTQUFTLEVBQUVDLCtCQUFrQkY7QUFGeEIsT0FBUDtBQUlEOztBQUVELFNBQUsxQixZQUFMLENBQWtCQyxpQ0FBb0I0QixXQUF0QztBQUNBLFdBQU87QUFDTDVDLE1BQUFBLE9BQU8sRUFBRSxLQURKO0FBRUwwQyxNQUFBQSxTQUFTLEVBQUVDLCtCQUFrQkU7QUFGeEIsS0FBUDtBQUlEOztBQUVELFFBQU1DLFNBQU4sR0FBa0I7QUFDaEIsVUFBTUMsa0JBQWtCLEdBQUcsdUJBQVNDLFFBQVQsQ0FBa0IsQ0FBbEIsRUFBcUIsT0FBckIsQ0FBM0I7QUFDQSxVQUFNQyxTQUFTLEdBQUcsS0FBS3ZHLE9BQUwsQ0FBYXVHLFNBQWIsSUFBMEJGLGtCQUFrQixDQUFDRyxNQUFuQixFQUE1Qzs7QUFDQSxVQUFNdkcsV0FBVyxHQUFHd0csZ0JBQU9DLEdBQVAsQ0FBV0wsa0JBQVgsRUFBK0IscUJBQU9FLFNBQVAsQ0FBL0IsQ0FBcEI7O0FBRUEsV0FBT3pELG9CQUFvQixDQUFDLEtBQUsxSCxJQUFOLG9CQUN0QixLQUFLNEUsT0FEaUI7QUFFekJwRixNQUFBQSxXQUFXLEVBQUUsS0FBS0EsV0FGTztBQUd6QitJLE1BQUFBLFdBQVcsRUFBRSxLQUFLQTtBQUhPLFFBSXhCMUQsV0FKd0IsQ0FBM0I7QUFLRDs7QUEzRzBEOztlQThHOUNzRCx1QiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgYnVpbGRVcmwgZnJvbSAnYnVpbGQtdXJsJztcbmltcG9ydCBtb21lbnQsIHsgTW9tZW50IH0gZnJvbSAnbW9tZW50JztcblxuaW1wb3J0IHsgUGFnZSB9IGZyb20gJ3B1cHBldGVlcic7XG5pbXBvcnQgeyBCYXNlU2NyYXBlcldpdGhCcm93c2VyIH0gZnJvbSAnLi9iYXNlLXNjcmFwZXItd2l0aC1icm93c2VyJztcbmltcG9ydCB7IGZldGNoR2V0V2l0aGluUGFnZSwgZmV0Y2hQb3N0V2l0aGluUGFnZSB9IGZyb20gJy4uL2hlbHBlcnMvZmV0Y2gnO1xuaW1wb3J0IHtcbiAgU0hFS0VMX0NVUlJFTkNZX0tFWVdPUkQsXG4gIFNIRUtFTF9DVVJSRU5DWSxcbiAgQUxUX1NIRUtFTF9DVVJSRU5DWSxcbn0gZnJvbSAnLi4vY29uc3RhbnRzJztcbmltcG9ydCBnZXRBbGxNb250aE1vbWVudHMgZnJvbSAnLi4vaGVscGVycy9kYXRlcyc7XG5pbXBvcnQgeyBmaXhJbnN0YWxsbWVudHMsIGZpbHRlck9sZFRyYW5zYWN0aW9ucyB9IGZyb20gJy4uL2hlbHBlcnMvdHJhbnNhY3Rpb25zJztcbmltcG9ydCB7XG4gIFRyYW5zYWN0aW9uc0FjY291bnQsIFRyYW5zYWN0aW9uLCBUcmFuc2FjdGlvbkluc3RhbGxtZW50cyxcbiAgVHJhbnNhY3Rpb25TdGF0dXNlcywgVHJhbnNhY3Rpb25UeXBlcyxcbn0gZnJvbSAnLi4vdHJhbnNhY3Rpb25zJztcbmltcG9ydCB7XG4gIFNjcmFwZXJFcnJvclR5cGVzLFxuICBTY3JhcGVyT3B0aW9ucywgU2NhcGVyU2NyYXBpbmdSZXN1bHQsIFNjYXBlclByb2dyZXNzVHlwZXMsXG4gIFNjcmFwZXJDcmVkZW50aWFscyxcbn0gZnJvbSAnLi9iYXNlLXNjcmFwZXInO1xuaW1wb3J0IHsgZ2V0RGVidWcgfSBmcm9tICcuLi9oZWxwZXJzL2RlYnVnJztcbmltcG9ydCB7IHJ1blNlcmlhbCB9IGZyb20gJy4uL2hlbHBlcnMvd2FpdGluZyc7XG5cbmNvbnN0IENPVU5UUllfQ09ERSA9ICcyMTInO1xuY29uc3QgSURfVFlQRSA9ICcxJztcbmNvbnN0IElOU1RBTExNRU5UU19LRVlXT1JEID0gJ9eq16nXnNeV150nO1xuXG5jb25zdCBEQVRFX0ZPUk1BVCA9ICdERC9NTS9ZWVlZJztcblxuY29uc3QgZGVidWcgPSBnZXREZWJ1ZygnYmFzZS1pc3JhY2FyZC1hbWV4Jyk7XG5cbmludGVyZmFjZSBFeHRlbmRlZFNjcmFwZXJPcHRpb25zIGV4dGVuZHMgU2NyYXBlck9wdGlvbnMge1xuICBzZXJ2aWNlc1VybDogc3RyaW5nO1xuICBjb21wYW55Q29kZTogc3RyaW5nO1xufVxuXG50eXBlIFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleCA9IFJlY29yZDxzdHJpbmcsIFRyYW5zYWN0aW9uc0FjY291bnQgJiB7IGluZGV4OiBudW1iZXIgfT47XG5cbmludGVyZmFjZSBTY3JhcGVkVHJhbnNhY3Rpb24ge1xuICBkZWFsU3VtVHlwZTogc3RyaW5nO1xuICB2b3VjaGVyTnVtYmVyUmF0ek91dGJvdW5kOiBzdHJpbmc7XG4gIHZvdWNoZXJOdW1iZXJSYXR6OiBzdHJpbmc7XG4gIG1vcmVJbmZvPzogc3RyaW5nO1xuICBkZWFsU3VtT3V0Ym91bmQ6IGJvb2xlYW47XG4gIGN1cnJlbmN5SWQ6IHN0cmluZztcbiAgZGVhbFN1bTogbnVtYmVyO1xuICBmdWxsUGF5bWVudERhdGU/OiBzdHJpbmc7XG4gIGZ1bGxQdXJjaGFzZURhdGU/OiBzdHJpbmc7XG4gIGZ1bGxQdXJjaGFzZURhdGVPdXRib3VuZD86IHN0cmluZztcbiAgZnVsbFN1cHBsaWVyTmFtZUhlYjogc3RyaW5nO1xuICBmdWxsU3VwcGxpZXJOYW1lT3V0Ym91bmQ6IHN0cmluZztcbiAgcGF5bWVudFN1bTogbnVtYmVyO1xuICBwYXltZW50U3VtT3V0Ym91bmQ6IG51bWJlcjtcbn1cblxuXG5pbnRlcmZhY2UgU2NyYXBlZEFjY291bnQge1xuICBpbmRleDogbnVtYmVyO1xuICBhY2NvdW50TnVtYmVyOiBzdHJpbmc7XG4gIHByb2Nlc3NlZERhdGU6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIFNjcmFwZWRMb2dpblZhbGlkYXRpb24ge1xuICBIZWFkZXI6IHtcbiAgICBTdGF0dXM6IHN0cmluZztcbiAgfTtcbiAgVmFsaWRhdGVJZERhdGFCZWFuPzoge1xuICAgIHVzZXJOYW1lPzogc3RyaW5nO1xuICAgIHJldHVybkNvZGU6IHN0cmluZztcbiAgfTtcbn1cblxuaW50ZXJmYWNlIFNjcmFwZWRBY2NvdW50c1dpdGhpblBhZ2VSZXNwb25zZSB7XG4gIEhlYWRlcjoge1xuICAgIFN0YXR1czogc3RyaW5nO1xuICB9O1xuICBEYXNoYm9hcmRNb250aEJlYW4/OiB7XG4gICAgY2FyZHNDaGFyZ2VzOiB7XG4gICAgICBjYXJkSW5kZXg6IHN0cmluZztcbiAgICAgIGNhcmROdW1iZXI6IHN0cmluZztcbiAgICAgIGJpbGxpbmdEYXRlOiBzdHJpbmc7XG4gICAgfVtdO1xuICB9O1xufVxuXG5pbnRlcmZhY2UgU2NyYXBlZEN1cnJlbnRDYXJkVHJhbnNhY3Rpb25zIHtcbiAgdHhuSXNyYWVsPzogU2NyYXBlZFRyYW5zYWN0aW9uW107XG4gIHR4bkFicm9hZD86IFNjcmFwZWRUcmFuc2FjdGlvbltdO1xufVxuXG5pbnRlcmZhY2UgU2NyYXBlZFRyYW5zYWN0aW9uRGF0YSB7XG4gIEhlYWRlcj86IHtcbiAgICBTdGF0dXM6IHN0cmluZztcbiAgfTtcbiAgQ2FyZHNUcmFuc2FjdGlvbnNMaXN0QmVhbj86IFJlY29yZDxzdHJpbmcsIHtcbiAgICBDdXJyZW50Q2FyZFRyYW5zYWN0aW9uczogU2NyYXBlZEN1cnJlbnRDYXJkVHJhbnNhY3Rpb25zW107XG4gIH0+O1xufVxuXG5mdW5jdGlvbiBnZXRBY2NvdW50c1VybChzZXJ2aWNlc1VybDogc3RyaW5nLCBtb250aE1vbWVudDogTW9tZW50KSB7XG4gIGNvbnN0IGJpbGxpbmdEYXRlID0gbW9udGhNb21lbnQuZm9ybWF0KCdZWVlZLU1NLUREJyk7XG4gIHJldHVybiBidWlsZFVybChzZXJ2aWNlc1VybCwge1xuICAgIHF1ZXJ5UGFyYW1zOiB7XG4gICAgICByZXFOYW1lOiAnRGFzaGJvYXJkTW9udGgnLFxuICAgICAgYWN0aW9uQ29kZTogJzAnLFxuICAgICAgYmlsbGluZ0RhdGUsXG4gICAgICBmb3JtYXQ6ICdKc29uJyxcbiAgICB9LFxuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hBY2NvdW50cyhwYWdlOiBQYWdlLCBzZXJ2aWNlc1VybDogc3RyaW5nLCBtb250aE1vbWVudDogTW9tZW50KTogUHJvbWlzZTxTY3JhcGVkQWNjb3VudFtdPiB7XG4gIGNvbnN0IGRhdGFVcmwgPSBnZXRBY2NvdW50c1VybChzZXJ2aWNlc1VybCwgbW9udGhNb21lbnQpO1xuICBjb25zdCBkYXRhUmVzdWx0ID0gYXdhaXQgZmV0Y2hHZXRXaXRoaW5QYWdlPFNjcmFwZWRBY2NvdW50c1dpdGhpblBhZ2VSZXNwb25zZT4ocGFnZSwgZGF0YVVybCk7XG4gIGlmIChkYXRhUmVzdWx0ICYmIF8uZ2V0KGRhdGFSZXN1bHQsICdIZWFkZXIuU3RhdHVzJykgPT09ICcxJyAmJiBkYXRhUmVzdWx0LkRhc2hib2FyZE1vbnRoQmVhbikge1xuICAgIGNvbnN0IHsgY2FyZHNDaGFyZ2VzIH0gPSBkYXRhUmVzdWx0LkRhc2hib2FyZE1vbnRoQmVhbjtcbiAgICBpZiAoY2FyZHNDaGFyZ2VzKSB7XG4gICAgICByZXR1cm4gY2FyZHNDaGFyZ2VzLm1hcCgoY2FyZENoYXJnZSkgPT4ge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGluZGV4OiBwYXJzZUludChjYXJkQ2hhcmdlLmNhcmRJbmRleCwgMTApLFxuICAgICAgICAgIGFjY291bnROdW1iZXI6IGNhcmRDaGFyZ2UuY2FyZE51bWJlcixcbiAgICAgICAgICBwcm9jZXNzZWREYXRlOiBtb21lbnQoY2FyZENoYXJnZS5iaWxsaW5nRGF0ZSwgREFURV9GT1JNQVQpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH07XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIFtdO1xufVxuXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbnNVcmwoc2VydmljZXNVcmw6IHN0cmluZywgbW9udGhNb21lbnQ6IE1vbWVudCkge1xuICBjb25zdCBtb250aCA9IG1vbnRoTW9tZW50Lm1vbnRoKCkgKyAxO1xuICBjb25zdCB5ZWFyID0gbW9udGhNb21lbnQueWVhcigpO1xuICBjb25zdCBtb250aFN0ciA9IG1vbnRoIDwgMTAgPyBgMCR7bW9udGh9YCA6IG1vbnRoLnRvU3RyaW5nKCk7XG4gIHJldHVybiBidWlsZFVybChzZXJ2aWNlc1VybCwge1xuICAgIHF1ZXJ5UGFyYW1zOiB7XG4gICAgICByZXFOYW1lOiAnQ2FyZHNUcmFuc2FjdGlvbnNMaXN0JyxcbiAgICAgIG1vbnRoOiBtb250aFN0cixcbiAgICAgIHllYXI6IGAke3llYXJ9YCxcbiAgICAgIHJlcXVpcmVkRGF0ZTogJ04nLFxuICAgIH0sXG4gIH0pO1xufVxuXG5mdW5jdGlvbiBjb252ZXJ0Q3VycmVuY3koY3VycmVuY3lTdHI6IHN0cmluZykge1xuICBpZiAoY3VycmVuY3lTdHIgPT09IFNIRUtFTF9DVVJSRU5DWV9LRVlXT1JEIHx8IGN1cnJlbmN5U3RyID09PSBBTFRfU0hFS0VMX0NVUlJFTkNZKSB7XG4gICAgcmV0dXJuIFNIRUtFTF9DVVJSRU5DWTtcbiAgfVxuICByZXR1cm4gY3VycmVuY3lTdHI7XG59XG5cbmZ1bmN0aW9uIGdldEluc3RhbGxtZW50c0luZm8odHhuOiBTY3JhcGVkVHJhbnNhY3Rpb24pOiBUcmFuc2FjdGlvbkluc3RhbGxtZW50cyB8IHVuZGVmaW5lZCB7XG4gIGlmICghdHhuLm1vcmVJbmZvIHx8ICF0eG4ubW9yZUluZm8uaW5jbHVkZXMoSU5TVEFMTE1FTlRTX0tFWVdPUkQpKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBjb25zdCBtYXRjaGVzID0gdHhuLm1vcmVJbmZvLm1hdGNoKC9cXGQrL2cpO1xuICBpZiAoIW1hdGNoZXMgfHwgbWF0Y2hlcy5sZW5ndGggPCAyKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgbnVtYmVyOiBwYXJzZUludChtYXRjaGVzWzBdLCAxMCksXG4gICAgdG90YWw6IHBhcnNlSW50KG1hdGNoZXNbMV0sIDEwKSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZ2V0VHJhbnNhY3Rpb25UeXBlKHR4bjogU2NyYXBlZFRyYW5zYWN0aW9uKSB7XG4gIHJldHVybiBnZXRJbnN0YWxsbWVudHNJbmZvKHR4bikgPyBUcmFuc2FjdGlvblR5cGVzLkluc3RhbGxtZW50cyA6IFRyYW5zYWN0aW9uVHlwZXMuTm9ybWFsO1xufVxuXG5mdW5jdGlvbiBjb252ZXJ0VHJhbnNhY3Rpb25zKHR4bnM6IFNjcmFwZWRUcmFuc2FjdGlvbltdLCBwcm9jZXNzZWREYXRlOiBzdHJpbmcpOiBUcmFuc2FjdGlvbltdIHtcbiAgY29uc3QgZmlsdGVyZWRUeG5zID0gdHhucy5maWx0ZXIoKHR4bikgPT4gdHhuLmRlYWxTdW1UeXBlICE9PSAnMScgJiZcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHhuLnZvdWNoZXJOdW1iZXJSYXR6ICE9PSAnMDAwMDAwMDAwJyAmJlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eG4udm91Y2hlck51bWJlclJhdHpPdXRib3VuZCAhPT0gJzAwMDAwMDAwMCcpO1xuXG4gIHJldHVybiBmaWx0ZXJlZFR4bnMubWFwKCh0eG4pID0+IHtcbiAgICBjb25zdCBpc091dGJvdW5kID0gdHhuLmRlYWxTdW1PdXRib3VuZDtcbiAgICBjb25zdCB0eG5EYXRlU3RyID0gaXNPdXRib3VuZCA/IHR4bi5mdWxsUHVyY2hhc2VEYXRlT3V0Ym91bmQgOiB0eG4uZnVsbFB1cmNoYXNlRGF0ZTtcbiAgICBjb25zdCB0eG5Nb21lbnQgPSBtb21lbnQodHhuRGF0ZVN0ciwgREFURV9GT1JNQVQpO1xuXG4gICAgY29uc3QgY3VycmVudFByb2Nlc3NlZERhdGUgPSB0eG4uZnVsbFBheW1lbnREYXRlID9cbiAgICAgIG1vbWVudCh0eG4uZnVsbFBheW1lbnREYXRlLCBEQVRFX0ZPUk1BVCkudG9JU09TdHJpbmcoKSA6XG4gICAgICBwcm9jZXNzZWREYXRlO1xuICAgIGNvbnN0IHJlc3VsdDogVHJhbnNhY3Rpb24gPSB7XG4gICAgICB0eXBlOiBnZXRUcmFuc2FjdGlvblR5cGUodHhuKSxcbiAgICAgIGlkZW50aWZpZXI6IHBhcnNlSW50KGlzT3V0Ym91bmQgPyB0eG4udm91Y2hlck51bWJlclJhdHpPdXRib3VuZCA6IHR4bi52b3VjaGVyTnVtYmVyUmF0eiwgMTApLFxuICAgICAgZGF0ZTogdHhuTW9tZW50LnRvSVNPU3RyaW5nKCksXG4gICAgICBwcm9jZXNzZWREYXRlOiBjdXJyZW50UHJvY2Vzc2VkRGF0ZSxcbiAgICAgIG9yaWdpbmFsQW1vdW50OiBpc091dGJvdW5kID8gLXR4bi5kZWFsU3VtT3V0Ym91bmQgOiAtdHhuLmRlYWxTdW0sXG4gICAgICBvcmlnaW5hbEN1cnJlbmN5OiBjb252ZXJ0Q3VycmVuY3kodHhuLmN1cnJlbmN5SWQpLFxuICAgICAgY2hhcmdlZEFtb3VudDogaXNPdXRib3VuZCA/IC10eG4ucGF5bWVudFN1bU91dGJvdW5kIDogLXR4bi5wYXltZW50U3VtLFxuICAgICAgZGVzY3JpcHRpb246IGlzT3V0Ym91bmQgPyB0eG4uZnVsbFN1cHBsaWVyTmFtZU91dGJvdW5kIDogdHhuLmZ1bGxTdXBwbGllck5hbWVIZWIsXG4gICAgICBtZW1vOiB0eG4ubW9yZUluZm8gfHwgJycsXG4gICAgICBpbnN0YWxsbWVudHM6IGdldEluc3RhbGxtZW50c0luZm8odHhuKSB8fCB1bmRlZmluZWQsXG4gICAgICBzdGF0dXM6IFRyYW5zYWN0aW9uU3RhdHVzZXMuQ29tcGxldGVkLFxuICAgIH07XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hUcmFuc2FjdGlvbnMocGFnZTogUGFnZSwgb3B0aW9uczogRXh0ZW5kZWRTY3JhcGVyT3B0aW9ucywgc3RhcnRNb21lbnQ6IE1vbWVudCwgbW9udGhNb21lbnQ6IE1vbWVudCk6IFByb21pc2U8U2NyYXBlZEFjY291bnRzV2l0aEluZGV4PiB7XG4gIGNvbnN0IGFjY291bnRzID0gYXdhaXQgZmV0Y2hBY2NvdW50cyhwYWdlLCBvcHRpb25zLnNlcnZpY2VzVXJsLCBtb250aE1vbWVudCk7XG4gIGNvbnN0IGRhdGFVcmwgPSBnZXRUcmFuc2FjdGlvbnNVcmwob3B0aW9ucy5zZXJ2aWNlc1VybCwgbW9udGhNb21lbnQpO1xuICBjb25zdCBkYXRhUmVzdWx0ID0gYXdhaXQgZmV0Y2hHZXRXaXRoaW5QYWdlPFNjcmFwZWRUcmFuc2FjdGlvbkRhdGE+KHBhZ2UsIGRhdGFVcmwpO1xuICBpZiAoZGF0YVJlc3VsdCAmJiBfLmdldChkYXRhUmVzdWx0LCAnSGVhZGVyLlN0YXR1cycpID09PSAnMScgJiYgZGF0YVJlc3VsdC5DYXJkc1RyYW5zYWN0aW9uc0xpc3RCZWFuKSB7XG4gICAgY29uc3QgYWNjb3VudFR4bnM6IFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleCA9IHt9O1xuICAgIGFjY291bnRzLmZvckVhY2goKGFjY291bnQpID0+IHtcbiAgICAgIGNvbnN0IHR4bkdyb3VwczogU2NyYXBlZEN1cnJlbnRDYXJkVHJhbnNhY3Rpb25zW10gPSBfLmdldChkYXRhUmVzdWx0LCBgQ2FyZHNUcmFuc2FjdGlvbnNMaXN0QmVhbi5JbmRleCR7YWNjb3VudC5pbmRleH0uQ3VycmVudENhcmRUcmFuc2FjdGlvbnNgKTtcbiAgICAgIGlmICh0eG5Hcm91cHMpIHtcbiAgICAgICAgbGV0IGFsbFR4bnM6IFRyYW5zYWN0aW9uW10gPSBbXTtcbiAgICAgICAgdHhuR3JvdXBzLmZvckVhY2goKHR4bkdyb3VwKSA9PiB7XG4gICAgICAgICAgaWYgKHR4bkdyb3VwLnR4bklzcmFlbCkge1xuICAgICAgICAgICAgY29uc3QgdHhucyA9IGNvbnZlcnRUcmFuc2FjdGlvbnModHhuR3JvdXAudHhuSXNyYWVsLCBhY2NvdW50LnByb2Nlc3NlZERhdGUpO1xuICAgICAgICAgICAgYWxsVHhucy5wdXNoKC4uLnR4bnMpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodHhuR3JvdXAudHhuQWJyb2FkKSB7XG4gICAgICAgICAgICBjb25zdCB0eG5zID0gY29udmVydFRyYW5zYWN0aW9ucyh0eG5Hcm91cC50eG5BYnJvYWQsIGFjY291bnQucHJvY2Vzc2VkRGF0ZSk7XG4gICAgICAgICAgICBhbGxUeG5zLnB1c2goLi4udHhucyk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoIW9wdGlvbnMuY29tYmluZUluc3RhbGxtZW50cykge1xuICAgICAgICAgIGFsbFR4bnMgPSBmaXhJbnN0YWxsbWVudHMoYWxsVHhucyk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG9wdGlvbnMub3V0cHV0RGF0YT8uZW5hYmxlVHJhbnNhY3Rpb25zRmlsdGVyQnlEYXRlID8/IHRydWUpIHtcbiAgICAgICAgICBhbGxUeG5zID0gZmlsdGVyT2xkVHJhbnNhY3Rpb25zKGFsbFR4bnMsIHN0YXJ0TW9tZW50LCBvcHRpb25zLmNvbWJpbmVJbnN0YWxsbWVudHMgfHwgZmFsc2UpO1xuICAgICAgICB9XG4gICAgICAgIGFjY291bnRUeG5zW2FjY291bnQuYWNjb3VudE51bWJlcl0gPSB7XG4gICAgICAgICAgYWNjb3VudE51bWJlcjogYWNjb3VudC5hY2NvdW50TnVtYmVyLFxuICAgICAgICAgIGluZGV4OiBhY2NvdW50LmluZGV4LFxuICAgICAgICAgIHR4bnM6IGFsbFR4bnMsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIGFjY291bnRUeG5zO1xuICB9XG5cbiAgcmV0dXJuIHt9O1xufVxuXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbkV4dHJhRGV0YWlscyhzZXJ2aWNlc1VybDogc3RyaW5nLCBtb250aDogTW9tZW50LCBhY2NvdW50SW5kZXg6IG51bWJlciwgdHJhbnNhY3Rpb246IFRyYW5zYWN0aW9uKTogc3RyaW5nIHtcbiAgY29uc3QgbW9lZENoaXV2ID0gbW9udGguZm9ybWF0KCdNTVlZWVknKTtcbiAgcmV0dXJuIGJ1aWxkVXJsKHNlcnZpY2VzVXJsLCB7XG4gICAgcXVlcnlQYXJhbXM6IHtcbiAgICAgIHJlcU5hbWU6ICdQaXJ0ZXlJc2thXzIwNCcsXG4gICAgICBDYXJkSW5kZXg6IGFjY291bnRJbmRleC50b1N0cmluZygpLFxuICAgICAgc2hvdmFyUmF0ejogdHJhbnNhY3Rpb24uaWRlbnRpZmllciEudG9TdHJpbmcoKSxcbiAgICAgIG1vZWRDaGl1dixcbiAgICB9LFxuICB9KTtcbn1cbmFzeW5jIGZ1bmN0aW9uIGdldEV4dHJhU2NyYXBUcmFuc2FjdGlvbihwYWdlOiBQYWdlLCBvcHRpb25zOiBFeHRlbmRlZFNjcmFwZXJPcHRpb25zLCBtb250aDogTW9tZW50LCBhY2NvdW50SW5kZXg6IG51bWJlciwgdHJhbnNhY3Rpb246IFRyYW5zYWN0aW9uKTogUHJvbWlzZTxUcmFuc2FjdGlvbj4ge1xuICBjb25zdCBkYXRhVXJsID0gZ2V0VHJhbnNhY3Rpb25FeHRyYURldGFpbHMob3B0aW9ucy5zZXJ2aWNlc1VybCwgbW9udGgsIGFjY291bnRJbmRleCwgdHJhbnNhY3Rpb24pO1xuICBjb25zdCBkYXRhID0gYXdhaXQgZmV0Y2hHZXRXaXRoaW5QYWdlPFNjcmFwZWRUcmFuc2FjdGlvbkRhdGE+KHBhZ2UsIGRhdGFVcmwpO1xuICBjb25zdCByYXdDYXRlZ29yeSA9IF8uZ2V0KGRhdGEsICdQaXJ0ZXlJc2thXzIwNEJlYW4uc2VjdG9yJyk7XG4gIHJldHVybiB7XG4gICAgLi4udHJhbnNhY3Rpb24sXG4gICAgY2F0ZWdvcnk6IHJhd0NhdGVnb3J5LnRyaW0oKSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gZ2V0RXh0cmFTY3JhcFRyYW5zYWN0aW9ucyhhY2NvdW50V2l0aEluZGV4OiBUcmFuc2FjdGlvbnNBY2NvdW50ICYgeyBpbmRleDogbnVtYmVyIH0sIHBhZ2U6IFBhZ2UsIG9wdGlvbnM6IEV4dGVuZGVkU2NyYXBlck9wdGlvbnMsIG1vbnRoOiBtb21lbnQuTW9tZW50KTogUHJvbWlzZTxUcmFuc2FjdGlvbltdPiB7XG4gIGNvbnN0IHByb21pc2VzID0gYWNjb3VudFdpdGhJbmRleC50eG5zXG4gICAgLm1hcCgodCkgPT4gZ2V0RXh0cmFTY3JhcFRyYW5zYWN0aW9uKHBhZ2UsIG9wdGlvbnMsIG1vbnRoLCBhY2NvdW50V2l0aEluZGV4LmluZGV4LCB0KSk7XG4gIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcyk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEV4dHJhU2NyYXBBY2NvdW50KHBhZ2U6IFBhZ2UsIG9wdGlvbnM6IEV4dGVuZGVkU2NyYXBlck9wdGlvbnMsIGFjY291bnRNYXA6IFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleCwgbW9udGg6IG1vbWVudC5Nb21lbnQpOiBQcm9taXNlPFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleD4ge1xuICBjb25zdCBwcm9taXNlcyA9IE9iamVjdC5rZXlzKGFjY291bnRNYXApXG4gICAgLm1hcChhc3luYyAoYSkgPT4gKHtcbiAgICAgIC4uLmFjY291bnRNYXBbYV0sXG4gICAgICB0eG5zOiBhd2FpdCBnZXRFeHRyYVNjcmFwVHJhbnNhY3Rpb25zKGFjY291bnRNYXBbYV0sIHBhZ2UsIG9wdGlvbnMsIG1vbnRoKSxcbiAgICB9KSk7XG4gIGNvbnN0IGFjY291bnRzID0gYXdhaXQgUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xuICByZXR1cm4gYWNjb3VudHMucmVkdWNlKChtLCB4KSA9PiAoeyAuLi5tLCBbeC5hY2NvdW50TnVtYmVyXTogeCB9KSwge30pO1xufVxuXG5mdW5jdGlvbiBnZXRFeHRyYVNjcmFwKGFjY291bnRzV2l0aEluZGV4OiBTY3JhcGVkQWNjb3VudHNXaXRoSW5kZXhbXSwgcGFnZTogUGFnZSwgb3B0aW9uczogRXh0ZW5kZWRTY3JhcGVyT3B0aW9ucywgYWxsTW9udGhzOiBtb21lbnQuTW9tZW50W10pOiBQcm9taXNlPFNjcmFwZWRBY2NvdW50c1dpdGhJbmRleFtdPiB7XG4gIGNvbnN0IGFjdGlvbnMgPSBhY2NvdW50c1dpdGhJbmRleC5tYXAoKGEsIGkpID0+ICgpID0+IGdldEV4dHJhU2NyYXBBY2NvdW50KHBhZ2UsIG9wdGlvbnMsIGEsIGFsbE1vbnRoc1tpXSkpO1xuICByZXR1cm4gcnVuU2VyaWFsKGFjdGlvbnMpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaEFsbFRyYW5zYWN0aW9ucyhwYWdlOiBQYWdlLCBvcHRpb25zOiBFeHRlbmRlZFNjcmFwZXJPcHRpb25zLCBzdGFydE1vbWVudDogTW9tZW50KSB7XG4gIGNvbnN0IGZ1dHVyZU1vbnRoc1RvU2NyYXBlID0gb3B0aW9ucy5mdXR1cmVNb250aHNUb1NjcmFwZSA/PyAxO1xuICBjb25zdCBhbGxNb250aHMgPSBnZXRBbGxNb250aE1vbWVudHMoc3RhcnRNb21lbnQsIGZ1dHVyZU1vbnRoc1RvU2NyYXBlKTtcbiAgY29uc3QgcmVzdWx0czogU2NyYXBlZEFjY291bnRzV2l0aEluZGV4W10gPSBhd2FpdCBQcm9taXNlLmFsbChhbGxNb250aHMubWFwKGFzeW5jIChtb250aE1vbWVudCkgPT4ge1xuICAgIHJldHVybiBmZXRjaFRyYW5zYWN0aW9ucyhwYWdlLCBvcHRpb25zLCBzdGFydE1vbWVudCwgbW9udGhNb21lbnQpO1xuICB9KSk7XG5cbiAgY29uc3QgZmluYWxSZXN1bHQgPSBvcHRpb25zLmFkZGl0aW9uYWxUcmFuc2FjdGlvbkluZm9ybWF0aW9uID9cbiAgICBhd2FpdCBnZXRFeHRyYVNjcmFwKHJlc3VsdHMsIHBhZ2UsIG9wdGlvbnMsIGFsbE1vbnRocykgOiByZXN1bHRzO1xuXG4gIGNvbnN0IGNvbWJpbmVkVHhuczogUmVjb3JkPHN0cmluZywgVHJhbnNhY3Rpb25bXT4gPSB7fTtcblxuICBmaW5hbFJlc3VsdC5mb3JFYWNoKChyZXN1bHQpID0+IHtcbiAgICBPYmplY3Qua2V5cyhyZXN1bHQpLmZvckVhY2goKGFjY291bnROdW1iZXIpID0+IHtcbiAgICAgIGxldCB0eG5zRm9yQWNjb3VudCA9IGNvbWJpbmVkVHhuc1thY2NvdW50TnVtYmVyXTtcbiAgICAgIGlmICghdHhuc0ZvckFjY291bnQpIHtcbiAgICAgICAgdHhuc0ZvckFjY291bnQgPSBbXTtcbiAgICAgICAgY29tYmluZWRUeG5zW2FjY291bnROdW1iZXJdID0gdHhuc0ZvckFjY291bnQ7XG4gICAgICB9XG4gICAgICBjb25zdCB0b0JlQWRkZWRUeG5zID0gcmVzdWx0W2FjY291bnROdW1iZXJdLnR4bnM7XG4gICAgICBjb21iaW5lZFR4bnNbYWNjb3VudE51bWJlcl0ucHVzaCguLi50b0JlQWRkZWRUeG5zKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgY29uc3QgYWNjb3VudHMgPSBPYmplY3Qua2V5cyhjb21iaW5lZFR4bnMpLm1hcCgoYWNjb3VudE51bWJlcikgPT4ge1xuICAgIHJldHVybiB7XG4gICAgICBhY2NvdW50TnVtYmVyLFxuICAgICAgdHhuczogY29tYmluZWRUeG5zW2FjY291bnROdW1iZXJdLFxuICAgIH07XG4gIH0pO1xuXG4gIHJldHVybiB7XG4gICAgc3VjY2VzczogdHJ1ZSxcbiAgICBhY2NvdW50cyxcbiAgfTtcbn1cblxuXG5jbGFzcyBJc3JhY2FyZEFtZXhCYXNlU2NyYXBlciBleHRlbmRzIEJhc2VTY3JhcGVyV2l0aEJyb3dzZXIge1xuICBwcml2YXRlIGJhc2VVcmw6IHN0cmluZztcblxuICBwcml2YXRlIGNvbXBhbnlDb2RlOiBzdHJpbmc7XG5cbiAgcHJpdmF0ZSBzZXJ2aWNlc1VybDogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFNjcmFwZXJPcHRpb25zLCBiYXNlVXJsOiBzdHJpbmcsIGNvbXBhbnlDb2RlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihvcHRpb25zKTtcblxuICAgIHRoaXMuYmFzZVVybCA9IGJhc2VVcmw7XG4gICAgdGhpcy5jb21wYW55Q29kZSA9IGNvbXBhbnlDb2RlO1xuICAgIHRoaXMuc2VydmljZXNVcmwgPSBgJHtiYXNlVXJsfS9zZXJ2aWNlcy9Qcm94eVJlcXVlc3RIYW5kbGVyLmFzaHhgO1xuICB9XG5cbiAgYXN5bmMgbG9naW4oY3JlZGVudGlhbHM6IFNjcmFwZXJDcmVkZW50aWFscyk6IFByb21pc2U8U2NhcGVyU2NyYXBpbmdSZXN1bHQ+IHtcbiAgICBhd2FpdCB0aGlzLnBhZ2Uuc2V0UmVxdWVzdEludGVyY2VwdGlvbih0cnVlKTtcbiAgICB0aGlzLnBhZ2Uub24oJ3JlcXVlc3QnLCAocmVxdWVzdCkgPT4ge1xuICAgICAgaWYgKHJlcXVlc3QudXJsKCkuaW5jbHVkZXMoJ2RldGVjdG9yLWRvbS5taW4uanMnKSkge1xuICAgICAgICBkZWJ1ZygnZm9yY2UgYWJvcnQgZm9yIHJlcXVlc3QgZG8gZG93bmxvYWQgZGV0ZWN0b3ItZG9tLm1pbi5qcyByZXNvdXJjZScpO1xuICAgICAgICByZXF1ZXN0LmFib3J0KCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXF1ZXN0LmNvbnRpbnVlKCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBkZWJ1ZygnbmF2aWdhdGUgdG8gbG9naW4gcGFnZScpO1xuICAgIGF3YWl0IHRoaXMubmF2aWdhdGVUbyhgJHt0aGlzLmJhc2VVcmx9L3BlcnNvbmFsYXJlYS9Mb2dpbmApO1xuXG4gICAgdGhpcy5lbWl0UHJvZ3Jlc3MoU2NhcGVyUHJvZ3Jlc3NUeXBlcy5Mb2dnaW5nSW4pO1xuXG4gICAgY29uc3QgdmFsaWRhdGVVcmwgPSBgJHt0aGlzLnNlcnZpY2VzVXJsfT9yZXFOYW1lPVZhbGlkYXRlSWREYXRhYDtcbiAgICBjb25zdCB2YWxpZGF0ZVJlcXVlc3QgPSB7XG4gICAgICBpZDogY3JlZGVudGlhbHMuaWQsXG4gICAgICBjYXJkU3VmZml4OiBjcmVkZW50aWFscy5jYXJkNkRpZ2l0cyxcbiAgICAgIGNvdW50cnlDb2RlOiBDT1VOVFJZX0NPREUsXG4gICAgICBpZFR5cGU6IElEX1RZUEUsXG4gICAgICBjaGVja0xldmVsOiAnMScsXG4gICAgICBjb21wYW55Q29kZTogdGhpcy5jb21wYW55Q29kZSxcbiAgICB9O1xuICAgIGNvbnN0IHZhbGlkYXRlUmVzdWx0ID0gYXdhaXQgZmV0Y2hQb3N0V2l0aGluUGFnZTxTY3JhcGVkTG9naW5WYWxpZGF0aW9uPih0aGlzLnBhZ2UsIHZhbGlkYXRlVXJsLCB2YWxpZGF0ZVJlcXVlc3QpO1xuICAgIGlmICghdmFsaWRhdGVSZXN1bHQgfHwgIXZhbGlkYXRlUmVzdWx0LkhlYWRlciB8fCB2YWxpZGF0ZVJlc3VsdC5IZWFkZXIuU3RhdHVzICE9PSAnMScgfHwgIXZhbGlkYXRlUmVzdWx0LlZhbGlkYXRlSWREYXRhQmVhbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCd1bmtub3duIGVycm9yIGR1cmluZyBsb2dpbicpO1xuICAgIH1cblxuICAgIGNvbnN0IHZhbGlkYXRlUmV0dXJuQ29kZSA9IHZhbGlkYXRlUmVzdWx0LlZhbGlkYXRlSWREYXRhQmVhbi5yZXR1cm5Db2RlO1xuICAgIGRlYnVnKGB1c2VyIHZhbGlkYXRlIHdpdGggcmV0dXJuIGNvZGUgJyR7dmFsaWRhdGVSZXR1cm5Db2RlfSdgKTtcbiAgICBpZiAodmFsaWRhdGVSZXR1cm5Db2RlID09PSAnMScpIHtcbiAgICAgIGNvbnN0IHsgdXNlck5hbWUgfSA9IHZhbGlkYXRlUmVzdWx0LlZhbGlkYXRlSWREYXRhQmVhbjtcblxuICAgICAgY29uc3QgbG9naW5VcmwgPSBgJHt0aGlzLnNlcnZpY2VzVXJsfT9yZXFOYW1lPXBlcmZvcm1Mb2dvbklgO1xuICAgICAgY29uc3QgcmVxdWVzdCA9IHtcbiAgICAgICAgS29kTWlzaHRhbWVzaDogdXNlck5hbWUsXG4gICAgICAgIE1pc3BhclppaHV5OiBjcmVkZW50aWFscy5pZCxcbiAgICAgICAgU2lzbWE6IGNyZWRlbnRpYWxzLnBhc3N3b3JkLFxuICAgICAgICBjYXJkU3VmZml4OiBjcmVkZW50aWFscy5jYXJkNkRpZ2l0cyxcbiAgICAgICAgY291bnRyeUNvZGU6IENPVU5UUllfQ09ERSxcbiAgICAgICAgaWRUeXBlOiBJRF9UWVBFLFxuICAgICAgfTtcbiAgICAgIGNvbnN0IGxvZ2luUmVzdWx0ID0gYXdhaXQgZmV0Y2hQb3N0V2l0aGluUGFnZTx7c3RhdHVzOiBzdHJpbmd9Pih0aGlzLnBhZ2UsIGxvZ2luVXJsLCByZXF1ZXN0KTtcbiAgICAgIGRlYnVnKGB1c2VyIGxvZ2luIHdpdGggc3RhdHVzICcke2xvZ2luUmVzdWx0Py5zdGF0dXN9J2ApO1xuXG4gICAgICBpZiAobG9naW5SZXN1bHQgJiYgbG9naW5SZXN1bHQuc3RhdHVzID09PSAnMScpIHtcbiAgICAgICAgdGhpcy5lbWl0UHJvZ3Jlc3MoU2NhcGVyUHJvZ3Jlc3NUeXBlcy5Mb2dpblN1Y2Nlc3MpO1xuICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XG4gICAgICB9XG5cbiAgICAgIGlmIChsb2dpblJlc3VsdCAmJiBsb2dpblJlc3VsdC5zdGF0dXMgPT09ICczJykge1xuICAgICAgICB0aGlzLmVtaXRQcm9ncmVzcyhTY2FwZXJQcm9ncmVzc1R5cGVzLkNoYW5nZVBhc3N3b3JkKTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBlcnJvclR5cGU6IFNjcmFwZXJFcnJvclR5cGVzLkNoYW5nZVBhc3N3b3JkLFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICB0aGlzLmVtaXRQcm9ncmVzcyhTY2FwZXJQcm9ncmVzc1R5cGVzLkxvZ2luRmFpbGVkKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICBlcnJvclR5cGU6IFNjcmFwZXJFcnJvclR5cGVzLkludmFsaWRQYXNzd29yZCxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgaWYgKHZhbGlkYXRlUmV0dXJuQ29kZSA9PT0gJzQnKSB7XG4gICAgICB0aGlzLmVtaXRQcm9ncmVzcyhTY2FwZXJQcm9ncmVzc1R5cGVzLkNoYW5nZVBhc3N3b3JkKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICBlcnJvclR5cGU6IFNjcmFwZXJFcnJvclR5cGVzLkNoYW5nZVBhc3N3b3JkLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICB0aGlzLmVtaXRQcm9ncmVzcyhTY2FwZXJQcm9ncmVzc1R5cGVzLkxvZ2luRmFpbGVkKTtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBlcnJvclR5cGU6IFNjcmFwZXJFcnJvclR5cGVzLkludmFsaWRQYXNzd29yZCxcbiAgICB9O1xuICB9XG5cbiAgYXN5bmMgZmV0Y2hEYXRhKCkge1xuICAgIGNvbnN0IGRlZmF1bHRTdGFydE1vbWVudCA9IG1vbWVudCgpLnN1YnRyYWN0KDEsICd5ZWFycycpO1xuICAgIGNvbnN0IHN0YXJ0RGF0ZSA9IHRoaXMub3B0aW9ucy5zdGFydERhdGUgfHwgZGVmYXVsdFN0YXJ0TW9tZW50LnRvRGF0ZSgpO1xuICAgIGNvbnN0IHN0YXJ0TW9tZW50ID0gbW9tZW50Lm1heChkZWZhdWx0U3RhcnRNb21lbnQsIG1vbWVudChzdGFydERhdGUpKTtcblxuICAgIHJldHVybiBmZXRjaEFsbFRyYW5zYWN0aW9ucyh0aGlzLnBhZ2UsIHtcbiAgICAgIC4uLnRoaXMub3B0aW9ucyxcbiAgICAgIHNlcnZpY2VzVXJsOiB0aGlzLnNlcnZpY2VzVXJsLFxuICAgICAgY29tcGFueUNvZGU6IHRoaXMuY29tcGFueUNvZGUsXG4gICAgfSwgc3RhcnRNb21lbnQpO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IElzcmFjYXJkQW1leEJhc2VTY3JhcGVyO1xuIl19