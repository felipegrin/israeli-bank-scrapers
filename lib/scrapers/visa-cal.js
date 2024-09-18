"use strict";

require("core-js/modules/es.symbol.description");

require("core-js/modules/es.array.iterator");

require("core-js/modules/es.promise");

require("core-js/modules/es.string.replace");

require("core-js/modules/es.string.trim");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _moment = _interopRequireDefault(require("moment"));

var _baseScraperWithBrowser = require("./base-scraper-with-browser");

var _elementsInteractions = require("../helpers/elements-interactions");

var _transactions = require("../transactions");

var _constants = require("../constants");

var _waiting = require("../helpers/waiting");

var _transactions2 = require("../helpers/transactions");

var _debug = require("../helpers/debug");

var _fetch = require("../helpers/fetch");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); if (enumerableOnly) symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; }); keys.push.apply(keys, symbols); } return keys; }

function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i] != null ? arguments[i] : {}; if (i % 2) { ownKeys(Object(source), true).forEach(function (key) { _defineProperty(target, key, source[key]); }); } else if (Object.getOwnPropertyDescriptors) { Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)); } else { ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } } return target; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

const LOGIN_URL = 'https://www.cal-online.co.il/';
const TRANSACTIONS_URL = 'https://services.cal-online.co.il/Card-Holders/Screens/Transactions/Transactions.aspx';
const GET_TX_DETAILS_URL = 'https://services.cal-online.co.il/Card-Holders/SCREENS/Transactions/Transactions.aspx/GetTransDetails';
const GET_TX_DETAILS_HEADER = {
  'Content-Type': 'application/json;charset=UTF-8'
};
const LONG_DATE_FORMAT = 'DD/MM/YYYY';
const DATE_FORMAT = 'DD/MM/YY';
const InvalidPasswordMessage = 'שם המשתמש או הסיסמה שהוזנו שגויים';
const debug = (0, _debug.getDebug)('visa-cal');

async function getLoginFrame(page) {
  let frame = null;
  debug('wait until login frame found');
  await (0, _waiting.waitUntil)(() => {
    frame = page.frames().find(f => f.url().includes('calconnect')) || null;
    return Promise.resolve(!!frame);
  }, 'wait for iframe with login form', 10000, 1000);

  if (!frame) {
    debug('failed to find login frame for 10 seconds');
    throw new Error('failed to extract login iframe');
  }

  return frame;
}

async function hasInvalidPasswordError(page) {
  const frame = await getLoginFrame(page);
  const errorFound = await (0, _elementsInteractions.elementPresentOnPage)(frame, 'div.general-error > div');
  const errorMessage = errorFound ? await (0, _elementsInteractions.pageEval)(frame, 'div.general-error > div', '', item => {
    return item.innerText;
  }) : '';
  return errorMessage === InvalidPasswordMessage;
}

function getPossibleLoginResults() {
  debug('return possible login results');
  const urls = {
    [_baseScraperWithBrowser.LoginResults.Success]: [/AccountManagement/i],
    [_baseScraperWithBrowser.LoginResults.InvalidPassword]: [async options => {
      const page = options === null || options === void 0 ? void 0 : options.page;

      if (!page) {
        return false;
      }

      return hasInvalidPasswordError(page);
    }] // [LoginResults.AccountBlocked]: [], // TODO add when reaching this scenario
    // [LoginResults.ChangePassword]: [], // TODO add when reaching this scenario

  };
  return urls;
}

function createLoginFields(credentials) {
  debug('create login fields for username and password');
  return [{
    selector: '[formcontrolname="userName"]',
    value: credentials.username
  }, {
    selector: '[formcontrolname="password"]',
    value: credentials.password
  }];
}

function getAmountData(amountStr) {
  const amountStrCln = amountStr.replace(',', '');
  let currency = null;
  let amount = null;

  if (amountStrCln.includes(_constants.SHEKEL_CURRENCY_SYMBOL)) {
    amount = -parseFloat(amountStrCln.replace(_constants.SHEKEL_CURRENCY_SYMBOL, ''));
    currency = _constants.SHEKEL_CURRENCY;
  } else if (amountStrCln.includes(_constants.DOLLAR_CURRENCY_SYMBOL)) {
    amount = -parseFloat(amountStrCln.replace(_constants.DOLLAR_CURRENCY_SYMBOL, ''));
    currency = _constants.DOLLAR_CURRENCY;
  } else if (amountStrCln.includes(_constants.EURO_CURRENCY_SYMBOL)) {
    amount = -parseFloat(amountStrCln.replace(_constants.EURO_CURRENCY_SYMBOL, ''));
    currency = _constants.EURO_CURRENCY;
  } else {
    const parts = amountStrCln.split(' ');
    [currency] = parts;
    amount = -parseFloat(parts[1]);
  }

  return {
    amount,
    currency
  };
}

function getTransactionInstallments(memo) {
  const parsedMemo = /תשלום (\d+) מתוך (\d+)/.exec(memo || '');

  if (!parsedMemo || parsedMemo.length === 0) {
    return null;
  }

  return {
    number: parseInt(parsedMemo[1], 10),
    total: parseInt(parsedMemo[2], 10)
  };
}

function getIdentifierAndNumerator(onclickValue) {
  if (!onclickValue) {
    debug('cannot extract the identifier of a transaction, onclick attribute not found for transaction');
    return {};
  }

  const expectedStartValue = 'OnMouseClickRow(this, event, "';

  if (!onclickValue.startsWith(expectedStartValue)) {
    debug(`cannot extract the identifier of a transaction, onclick attribute value doesnt start with expected value '${onclickValue}'`);
    return {};
  }

  const thirdArgument = onclickValue.substring(expectedStartValue.length, onclickValue.length - 2);
  const splits = thirdArgument.split('|');

  if (splits.length !== 2) {
    debug(`cannot extract the identifier of a transaction, unexpected 3rd argument in onclick value '${onclickValue}'`);
    return {};
  }

  return {
    identifier: splits[1],
    numerator: splits[0]
  };
}

function convertTransactions(txns) {
  debug(`convert ${txns.length} raw transactions to official Transaction structure`);
  return txns.map(txn => {
    var _getIdentifierAndNume, _txn$additionalInfo;

    const originalAmountTuple = getAmountData(txn.originalAmount || '');
    const chargedAmountTuple = getAmountData(txn.chargedAmount || '');
    const installments = getTransactionInstallments(txn.memo);
    const txnDate = (0, _moment.default)(txn.date, DATE_FORMAT);
    const processedDateFormat = txn.processedDate.length === 8 ? DATE_FORMAT : txn.processedDate.length === 9 || txn.processedDate.length === 10 ? LONG_DATE_FORMAT : null;

    if (!processedDateFormat) {
      throw new Error('invalid processed date');
    }

    const txnProcessedDate = (0, _moment.default)(txn.processedDate, processedDateFormat);
    const result = {
      identifier: (_getIdentifierAndNume = getIdentifierAndNumerator(txn.onclick)) === null || _getIdentifierAndNume === void 0 ? void 0 : _getIdentifierAndNume.identifier,
      type: installments ? _transactions.TransactionTypes.Installments : _transactions.TransactionTypes.Normal,
      status: _transactions.TransactionStatuses.Completed,
      date: installments ? txnDate.add(installments.number - 1, 'month').toISOString() : txnDate.toISOString(),
      processedDate: txnProcessedDate.toISOString(),
      originalAmount: originalAmountTuple.amount,
      originalCurrency: originalAmountTuple.currency,
      chargedAmount: chargedAmountTuple.amount,
      chargedCurrency: chargedAmountTuple.currency,
      description: txn.description || '',
      memo: txn.memo || '',
      category: (_txn$additionalInfo = txn.additionalInfo) === null || _txn$additionalInfo === void 0 ? void 0 : _txn$additionalInfo.category
    };

    if (installments) {
      result.installments = installments;
    }

    return result;
  });
}

async function getAdditionalTxInfo(tx, page) {
  var _result$d, _result$d$Data, _result$d$Data$Mercha;

  const {
    identifier,
    numerator
  } = getIdentifierAndNumerator(tx.onclick);

  if (identifier === undefined || numerator === undefined) {
    return null;
  }

  const result = await (0, _fetch.fetchPostWithinPage)(page, GET_TX_DETAILS_URL, {
    Identifier: identifier,
    Numerator: numerator
  }, GET_TX_DETAILS_HEADER);
  return {
    category: ((_result$d = result.d) === null || _result$d === void 0 ? void 0 : (_result$d$Data = _result$d.Data) === null || _result$d$Data === void 0 ? void 0 : (_result$d$Data$Mercha = _result$d$Data.MerchantDetails) === null || _result$d$Data$Mercha === void 0 ? void 0 : _result$d$Data$Mercha.SectorName) || undefined
  };
}

async function getAdditionalTxsInfoIfNeeded(txs, scraperOptions, page) {
  if (!scraperOptions.additionalTransactionInformation) {
    return txs;
  }

  const promises = txs.map(async x => _objectSpread({}, x, {
    additionalInfo: await getAdditionalTxInfo(x, page)
  }));
  return Promise.all(promises);
}

async function fetchTransactionsForAccount(page, startDate, accountNumber, scraperOptions) {
  var _scraperOptions$outpu, _scraperOptions$outpu2;

  const startDateValue = startDate.format('MM/YYYY');
  const dateSelector = '[id$="FormAreaNoBorder_FormArea_clndrDebitDateScope_TextBox"]';
  const dateHiddenFieldSelector = '[id$="FormAreaNoBorder_FormArea_clndrDebitDateScope_HiddenField"]';
  const buttonSelector = '[id$="FormAreaNoBorder_FormArea_ctlSubmitRequest"]';
  const nextPageSelector = '[id$="FormAreaNoBorder_FormArea_ctlGridPager_btnNext"]';
  const billingLabelSelector = '[id$=FormAreaNoBorder_FormArea_ctlMainToolBar_lblCaption]';
  const secondaryBillingLabelSelector = '[id$=FormAreaNoBorder_FormArea_ctlSecondaryToolBar_lblCaption]';
  const noDataSelector = '[id$=FormAreaNoBorder_FormArea_msgboxErrorMessages]';
  debug('find the start date index in the dropbox');
  const options = await (0, _elementsInteractions.pageEvalAll)(page, '[id$="FormAreaNoBorder_FormArea_clndrDebitDateScope_OptionList"] li', [], items => {
    return items.map(el => el.innerText);
  });
  const startDateIndex = options.findIndex(option => option === startDateValue);
  debug(`scrape ${options.length - startDateIndex} billing cycles`);
  const accountTransactions = [];

  for (let currentDateIndex = startDateIndex; currentDateIndex < options.length; currentDateIndex += 1) {
    debug('wait for date selector to be found');
    await (0, _elementsInteractions.waitUntilElementFound)(page, dateSelector, true);
    debug(`set hidden value of the date selector to be the index ${currentDateIndex}`);
    await (0, _elementsInteractions.setValue)(page, dateHiddenFieldSelector, `${currentDateIndex}`);
    debug('wait a second to workaround navigation issue in headless browser mode');
    await page.waitForTimeout(1000);
    debug('click on the filter submit button and wait for navigation');
    await Promise.all([page.waitForNavigation({
      waitUntil: 'domcontentloaded'
    }), (0, _elementsInteractions.clickButton)(page, buttonSelector)]);
    debug('check if month has no transactions');
    const pageHasNoTransactions = await (0, _elementsInteractions.pageEval)(page, noDataSelector, false, element => {
      const siteValue = (element.innerText || '').replace(/[^ א-ת]/g, '');
      return siteValue === 'לא נמצאו נתונים';
    });

    if (pageHasNoTransactions) {
      debug('page has no transactions');
    } else {
      var _settlementDateRegex$;

      debug('find the billing date');
      let billingDateLabel = await (0, _elementsInteractions.pageEval)(page, billingLabelSelector, '', element => {
        return element.innerText;
      });
      let settlementDateRegex = /\d{1,2}[/]\d{2}[/]\d{2,4}/;

      if (billingDateLabel === '') {
        billingDateLabel = await (0, _elementsInteractions.pageEval)(page, secondaryBillingLabelSelector, '', element => {
          return element.innerText;
        });
        settlementDateRegex = /\d{1,2}[/]\d{2,4}/;
      }

      const billingDate = (_settlementDateRegex$ = settlementDateRegex.exec(billingDateLabel)) === null || _settlementDateRegex$ === void 0 ? void 0 : _settlementDateRegex$[0];

      if (!billingDate) {
        throw new Error('failed to fetch process date');
      }

      debug(`found the billing date for that month ${billingDate}`);
      let hasNextPage = false;

      do {
        debug('fetch raw transactions from page');
        const rawTransactions = await (0, _elementsInteractions.pageEvalAll)(page, '#ctlMainGrid > tbody tr, #ctlSecondaryGrid > tbody tr', [], (items, billingDate) => {
          return items.map(el => {
            const columns = el.getElementsByTagName('td');
            const onclick = el.getAttribute('onclick');

            if (columns.length === 6) {
              return {
                onclick,
                processedDate: columns[0].innerText,
                date: columns[1].innerText,
                description: columns[2].innerText,
                originalAmount: columns[3].innerText,
                chargedAmount: columns[4].innerText,
                memo: columns[5].innerText
              };
            }

            if (columns.length === 5) {
              return {
                onclick,
                processedDate: billingDate,
                date: columns[0].innerText,
                description: columns[1].innerText,
                originalAmount: columns[2].innerText,
                chargedAmount: columns[3].innerText,
                memo: columns[4].innerText
              };
            }

            return null;
          });
        }, billingDate);
        debug(`fetched ${rawTransactions.length} raw transactions from page`);
        const existsTxs = rawTransactions.filter(item => !!item);
        const fullScrappedTxs = await getAdditionalTxsInfoIfNeeded(existsTxs, scraperOptions, page);
        accountTransactions.push(...convertTransactions(fullScrappedTxs));
        debug('check for existence of another page');
        hasNextPage = await (0, _elementsInteractions.elementPresentOnPage)(page, nextPageSelector);

        if (hasNextPage) {
          debug('has another page, click on button next and wait for page navigation');
          await Promise.all([page.waitForNavigation({
            waitUntil: 'domcontentloaded'
          }), await (0, _elementsInteractions.clickButton)(page, '[id$=FormAreaNoBorder_FormArea_ctlGridPager_btnNext]')]);
        }
      } while (hasNextPage);
    }
  }

  debug('filer out old transactions');
  const txns = ((_scraperOptions$outpu = (_scraperOptions$outpu2 = scraperOptions.outputData) === null || _scraperOptions$outpu2 === void 0 ? void 0 : _scraperOptions$outpu2.enableTransactionsFilterByDate) !== null && _scraperOptions$outpu !== void 0 ? _scraperOptions$outpu : true) ? (0, _transactions2.filterOldTransactions)(accountTransactions, startDate, scraperOptions.combineInstallments || false) : accountTransactions;
  debug(`found ${txns.length} valid transactions out of ${accountTransactions.length} transactions for account ending with ${accountNumber.substring(accountNumber.length - 2)}`);
  return {
    accountNumber,
    txns
  };
}

async function getAccountNumbers(page) {
  return (0, _elementsInteractions.pageEvalAll)(page, '[id$=lnkItem]', [], elements => elements.map(e => e.text)).then(res => res.map(text => {
    var _$exec$, _$exec;

    return (_$exec$ = (_$exec = /\d+$/.exec(text.trim())) === null || _$exec === void 0 ? void 0 : _$exec[0]) !== null && _$exec$ !== void 0 ? _$exec$ : '';
  }));
}

async function setAccount(page, account) {
  await (0, _elementsInteractions.pageEvalAll)(page, '[id$=lnkItem]', null, (elements, account) => {
    for (const elem of elements) {
      const a = elem;

      if (a.text.includes(account)) {
        a.click();
      }
    }
  }, account);
}

async function fetchTransactions(page, startDate, scraperOptions) {
  const accountNumbers = await getAccountNumbers(page);
  const accounts = [];

  for (const account of accountNumbers) {
    debug(`setting account: ${account}`);
    await setAccount(page, account);
    await page.waitForTimeout(1000);
    accounts.push((await fetchTransactionsForAccount(page, startDate, account, scraperOptions)));
  }

  return accounts;
}

async function fetchFutureDebits(page) {
  const futureDebitsSelector = '.homepage-banks-top';
  const result = await (0, _elementsInteractions.pageEvalAll)(page, futureDebitsSelector, [], items => {
    const debitMountClass = 'amount';
    const debitWhenChargeClass = 'when-charge';
    const debitBankNumberClass = 'bankDesc';
    return items.map(currBankEl => {
      const amount = currBankEl.getElementsByClassName(debitMountClass)[0].innerText;
      const whenCharge = currBankEl.getElementsByClassName(debitWhenChargeClass)[0].innerText;
      const bankNumber = currBankEl.getElementsByClassName(debitBankNumberClass)[0].innerText;
      return {
        amount,
        whenCharge,
        bankNumber
      };
    });
  });
  const futureDebits = result.map(item => {
    var _$exec2, _$exec3;

    const amountData = getAmountData(item.amount);
    const chargeDate = (_$exec2 = /\d{1,2}[/]\d{2}[/]\d{2,4}/.exec(item.whenCharge)) === null || _$exec2 === void 0 ? void 0 : _$exec2[0];
    const bankAccountNumber = (_$exec3 = /\d+-\d+/.exec(item.bankNumber)) === null || _$exec3 === void 0 ? void 0 : _$exec3[0];
    return {
      amount: amountData.amount,
      amountCurrency: amountData.currency,
      chargeDate,
      bankAccountNumber
    };
  });
  return futureDebits;
}

class VisaCalScraper extends _baseScraperWithBrowser.BaseScraperWithBrowser {
  constructor(...args) {
    super(...args);

    _defineProperty(this, "openLoginPopup", async () => {
      debug('open login popup, wait until login button available');
      await (0, _elementsInteractions.waitUntilElementFound)(this.page, '#ccLoginDesktopBtn', true);
      debug('click on the login button');
      await (0, _elementsInteractions.clickButton)(this.page, '#ccLoginDesktopBtn');
      debug('get the frame that holds the login');
      const frame = await getLoginFrame(this.page);
      debug('wait until the password login tab header is available');
      await (0, _elementsInteractions.waitUntilElementFound)(frame, '#regular-login');
      debug('navigate to the password login tab');
      await (0, _elementsInteractions.clickButton)(frame, '#regular-login');
      debug('wait until the password login tab is active');
      await (0, _elementsInteractions.waitUntilElementFound)(frame, 'regular-login');
      return frame;
    });
  }

  getLoginOptions(credentials) {
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: 'button[type="submit"]',
      possibleResults: getPossibleLoginResults(),
      checkReadiness: async () => (0, _elementsInteractions.waitUntilElementFound)(this.page, '#ccLoginDesktopBtn'),
      preAction: this.openLoginPopup,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36'
    };
  }

  async fetchData() {
    const defaultStartMoment = (0, _moment.default)().subtract(1, 'years').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();

    const startMoment = _moment.default.max(defaultStartMoment, (0, _moment.default)(startDate));

    debug(`fetch transactions starting ${startMoment.format()}`);
    debug('fetch future debits');
    const futureDebits = await fetchFutureDebits(this.page);
    debug('navigate to transactions page');
    await this.navigateTo(TRANSACTIONS_URL, undefined, 60000);
    debug('fetch accounts transactions');
    const accounts = await fetchTransactions(this.page, startMoment, this.options);
    debug('return the scraped accounts');
    return {
      success: true,
      accounts,
      futureDebits
    };
  }

}

var _default = VisaCalScraper;
exports.default = _default;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9zY3JhcGVycy92aXNhLWNhbC50cyJdLCJuYW1lcyI6WyJMT0dJTl9VUkwiLCJUUkFOU0FDVElPTlNfVVJMIiwiR0VUX1RYX0RFVEFJTFNfVVJMIiwiR0VUX1RYX0RFVEFJTFNfSEVBREVSIiwiTE9OR19EQVRFX0ZPUk1BVCIsIkRBVEVfRk9STUFUIiwiSW52YWxpZFBhc3N3b3JkTWVzc2FnZSIsImRlYnVnIiwiZ2V0TG9naW5GcmFtZSIsInBhZ2UiLCJmcmFtZSIsImZyYW1lcyIsImZpbmQiLCJmIiwidXJsIiwiaW5jbHVkZXMiLCJQcm9taXNlIiwicmVzb2x2ZSIsIkVycm9yIiwiaGFzSW52YWxpZFBhc3N3b3JkRXJyb3IiLCJlcnJvckZvdW5kIiwiZXJyb3JNZXNzYWdlIiwiaXRlbSIsImlubmVyVGV4dCIsImdldFBvc3NpYmxlTG9naW5SZXN1bHRzIiwidXJscyIsIkxvZ2luUmVzdWx0cyIsIlN1Y2Nlc3MiLCJJbnZhbGlkUGFzc3dvcmQiLCJvcHRpb25zIiwiY3JlYXRlTG9naW5GaWVsZHMiLCJjcmVkZW50aWFscyIsInNlbGVjdG9yIiwidmFsdWUiLCJ1c2VybmFtZSIsInBhc3N3b3JkIiwiZ2V0QW1vdW50RGF0YSIsImFtb3VudFN0ciIsImFtb3VudFN0ckNsbiIsInJlcGxhY2UiLCJjdXJyZW5jeSIsImFtb3VudCIsIlNIRUtFTF9DVVJSRU5DWV9TWU1CT0wiLCJwYXJzZUZsb2F0IiwiU0hFS0VMX0NVUlJFTkNZIiwiRE9MTEFSX0NVUlJFTkNZX1NZTUJPTCIsIkRPTExBUl9DVVJSRU5DWSIsIkVVUk9fQ1VSUkVOQ1lfU1lNQk9MIiwiRVVST19DVVJSRU5DWSIsInBhcnRzIiwic3BsaXQiLCJnZXRUcmFuc2FjdGlvbkluc3RhbGxtZW50cyIsIm1lbW8iLCJwYXJzZWRNZW1vIiwiZXhlYyIsImxlbmd0aCIsIm51bWJlciIsInBhcnNlSW50IiwidG90YWwiLCJnZXRJZGVudGlmaWVyQW5kTnVtZXJhdG9yIiwib25jbGlja1ZhbHVlIiwiZXhwZWN0ZWRTdGFydFZhbHVlIiwic3RhcnRzV2l0aCIsInRoaXJkQXJndW1lbnQiLCJzdWJzdHJpbmciLCJzcGxpdHMiLCJpZGVudGlmaWVyIiwibnVtZXJhdG9yIiwiY29udmVydFRyYW5zYWN0aW9ucyIsInR4bnMiLCJtYXAiLCJ0eG4iLCJvcmlnaW5hbEFtb3VudFR1cGxlIiwib3JpZ2luYWxBbW91bnQiLCJjaGFyZ2VkQW1vdW50VHVwbGUiLCJjaGFyZ2VkQW1vdW50IiwiaW5zdGFsbG1lbnRzIiwidHhuRGF0ZSIsImRhdGUiLCJwcm9jZXNzZWREYXRlRm9ybWF0IiwicHJvY2Vzc2VkRGF0ZSIsInR4blByb2Nlc3NlZERhdGUiLCJyZXN1bHQiLCJvbmNsaWNrIiwidHlwZSIsIlRyYW5zYWN0aW9uVHlwZXMiLCJJbnN0YWxsbWVudHMiLCJOb3JtYWwiLCJzdGF0dXMiLCJUcmFuc2FjdGlvblN0YXR1c2VzIiwiQ29tcGxldGVkIiwiYWRkIiwidG9JU09TdHJpbmciLCJvcmlnaW5hbEN1cnJlbmN5IiwiY2hhcmdlZEN1cnJlbmN5IiwiZGVzY3JpcHRpb24iLCJjYXRlZ29yeSIsImFkZGl0aW9uYWxJbmZvIiwiZ2V0QWRkaXRpb25hbFR4SW5mbyIsInR4IiwidW5kZWZpbmVkIiwiSWRlbnRpZmllciIsIk51bWVyYXRvciIsImQiLCJEYXRhIiwiTWVyY2hhbnREZXRhaWxzIiwiU2VjdG9yTmFtZSIsImdldEFkZGl0aW9uYWxUeHNJbmZvSWZOZWVkZWQiLCJ0eHMiLCJzY3JhcGVyT3B0aW9ucyIsImFkZGl0aW9uYWxUcmFuc2FjdGlvbkluZm9ybWF0aW9uIiwicHJvbWlzZXMiLCJ4IiwiYWxsIiwiZmV0Y2hUcmFuc2FjdGlvbnNGb3JBY2NvdW50Iiwic3RhcnREYXRlIiwiYWNjb3VudE51bWJlciIsInN0YXJ0RGF0ZVZhbHVlIiwiZm9ybWF0IiwiZGF0ZVNlbGVjdG9yIiwiZGF0ZUhpZGRlbkZpZWxkU2VsZWN0b3IiLCJidXR0b25TZWxlY3RvciIsIm5leHRQYWdlU2VsZWN0b3IiLCJiaWxsaW5nTGFiZWxTZWxlY3RvciIsInNlY29uZGFyeUJpbGxpbmdMYWJlbFNlbGVjdG9yIiwibm9EYXRhU2VsZWN0b3IiLCJpdGVtcyIsImVsIiwic3RhcnREYXRlSW5kZXgiLCJmaW5kSW5kZXgiLCJvcHRpb24iLCJhY2NvdW50VHJhbnNhY3Rpb25zIiwiY3VycmVudERhdGVJbmRleCIsIndhaXRGb3JUaW1lb3V0Iiwid2FpdEZvck5hdmlnYXRpb24iLCJ3YWl0VW50aWwiLCJwYWdlSGFzTm9UcmFuc2FjdGlvbnMiLCJlbGVtZW50Iiwic2l0ZVZhbHVlIiwiYmlsbGluZ0RhdGVMYWJlbCIsInNldHRsZW1lbnREYXRlUmVnZXgiLCJiaWxsaW5nRGF0ZSIsImhhc05leHRQYWdlIiwicmF3VHJhbnNhY3Rpb25zIiwiY29sdW1ucyIsImdldEVsZW1lbnRzQnlUYWdOYW1lIiwiZ2V0QXR0cmlidXRlIiwiZXhpc3RzVHhzIiwiZmlsdGVyIiwiZnVsbFNjcmFwcGVkVHhzIiwicHVzaCIsIm91dHB1dERhdGEiLCJlbmFibGVUcmFuc2FjdGlvbnNGaWx0ZXJCeURhdGUiLCJjb21iaW5lSW5zdGFsbG1lbnRzIiwiZ2V0QWNjb3VudE51bWJlcnMiLCJlbGVtZW50cyIsImUiLCJ0ZXh0IiwidGhlbiIsInJlcyIsInRyaW0iLCJzZXRBY2NvdW50IiwiYWNjb3VudCIsImVsZW0iLCJhIiwiY2xpY2siLCJmZXRjaFRyYW5zYWN0aW9ucyIsImFjY291bnROdW1iZXJzIiwiYWNjb3VudHMiLCJmZXRjaEZ1dHVyZURlYml0cyIsImZ1dHVyZURlYml0c1NlbGVjdG9yIiwiZGViaXRNb3VudENsYXNzIiwiZGViaXRXaGVuQ2hhcmdlQ2xhc3MiLCJkZWJpdEJhbmtOdW1iZXJDbGFzcyIsImN1cnJCYW5rRWwiLCJnZXRFbGVtZW50c0J5Q2xhc3NOYW1lIiwid2hlbkNoYXJnZSIsImJhbmtOdW1iZXIiLCJmdXR1cmVEZWJpdHMiLCJhbW91bnREYXRhIiwiY2hhcmdlRGF0ZSIsImJhbmtBY2NvdW50TnVtYmVyIiwiYW1vdW50Q3VycmVuY3kiLCJWaXNhQ2FsU2NyYXBlciIsIkJhc2VTY3JhcGVyV2l0aEJyb3dzZXIiLCJnZXRMb2dpbk9wdGlvbnMiLCJsb2dpblVybCIsImZpZWxkcyIsInN1Ym1pdEJ1dHRvblNlbGVjdG9yIiwicG9zc2libGVSZXN1bHRzIiwiY2hlY2tSZWFkaW5lc3MiLCJwcmVBY3Rpb24iLCJvcGVuTG9naW5Qb3B1cCIsInVzZXJBZ2VudCIsImZldGNoRGF0YSIsImRlZmF1bHRTdGFydE1vbWVudCIsInN1YnRyYWN0IiwidG9EYXRlIiwic3RhcnRNb21lbnQiLCJtb21lbnQiLCJtYXgiLCJuYXZpZ2F0ZVRvIiwic3VjY2VzcyJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTs7QUFFQTs7QUFDQTs7QUFHQTs7QUFRQTs7QUFHQTs7QUFDQTs7QUFDQTs7QUFDQTs7Ozs7Ozs7OztBQUVBLE1BQU1BLFNBQVMsR0FBRywrQkFBbEI7QUFDQSxNQUFNQyxnQkFBZ0IsR0FBRyx1RkFBekI7QUFDQSxNQUFNQyxrQkFBa0IsR0FBRyx1R0FBM0I7QUFDQSxNQUFNQyxxQkFBcUIsR0FBRztBQUFFLGtCQUFnQjtBQUFsQixDQUE5QjtBQUNBLE1BQU1DLGdCQUFnQixHQUFHLFlBQXpCO0FBQ0EsTUFBTUMsV0FBVyxHQUFHLFVBQXBCO0FBQ0EsTUFBTUMsc0JBQXNCLEdBQUcsbUNBQS9CO0FBRUEsTUFBTUMsS0FBSyxHQUFHLHFCQUFTLFVBQVQsQ0FBZDs7QUFrQkEsZUFBZUMsYUFBZixDQUE2QkMsSUFBN0IsRUFBeUM7QUFDdkMsTUFBSUMsS0FBbUIsR0FBRyxJQUExQjtBQUNBSCxFQUFBQSxLQUFLLENBQUMsOEJBQUQsQ0FBTDtBQUNBLFFBQU0sd0JBQVUsTUFBTTtBQUNwQkcsSUFBQUEsS0FBSyxHQUFHRCxJQUFJLENBQ1RFLE1BREssR0FFTEMsSUFGSyxDQUVDQyxDQUFELElBQU9BLENBQUMsQ0FBQ0MsR0FBRixHQUFRQyxRQUFSLENBQWlCLFlBQWpCLENBRlAsS0FFMEMsSUFGbEQ7QUFHQSxXQUFPQyxPQUFPLENBQUND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QUFTLEdBQUcsS0FBS3RGLE9BQUwsQ0FBYXNGLFNBQWIsSUFBMEJnRixrQkFBa0IsQ0FBQ0UsTUFBbkIsRUFBNUM7O0FBQ0EsVUFBTUMsV0FBVyxHQUFHQyxnQkFBT0MsR0FBUCxDQUFXTCxrQkFBWCxFQUErQixxQkFBT2hGLFNBQVAsQ0FBL0IsQ0FBcEI7O0FBQ0E1RyxJQUFBQSxLQUFLLENBQUUsK0JBQThCK0wsV0FBVyxDQUFDaEYsTUFBWixFQUFxQixFQUFyRCxDQUFMO0FBRUEvRyxJQUFBQSxLQUFLLENBQUMscUJBQUQsQ0FBTDtBQUNBLFVBQU0ySyxZQUFZLEdBQUcsTUFBTVQsaUJBQWlCLENBQUMsS0FBS2hLLElBQU4sQ0FBNUM7QUFFQUYsSUFBQUEsS0FBSyxDQUFDLCtCQUFELENBQUw7QUFDQSxVQUFNLEtBQUtrTSxVQUFMLENBQWdCeE0sZ0JBQWhCLEVBQWtDbUcsU0FBbEMsRUFBNkMsS0FBN0MsQ0FBTjtBQUVBN0YsSUFBQUEsS0FBSyxDQUFDLDZCQUFELENBQUw7QUFDQSxVQUFNaUssUUFBUSxHQUFHLE1BQU1GLGlCQUFpQixDQUFDLEtBQUs3SixJQUFOLEVBQVk2TCxXQUFaLEVBQXlCLEtBQUt6SyxPQUE5QixDQUF4QztBQUVBdEIsSUFBQUEsS0FBSyxDQUFDLDZCQUFELENBQUw7QUFDQSxXQUFPO0FBQ0xtTSxNQUFBQSxPQUFPLEVBQUUsSUFESjtBQUVMbEMsTUFBQUEsUUFGSztBQUdMVSxNQUFBQTtBQUhLLEtBQVA7QUFLRDs7QUFuRGlEOztlQXNEckNLLGMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgbW9tZW50LCB7IE1vbWVudCB9IGZyb20gJ21vbWVudCc7XG5pbXBvcnQgeyBGcmFtZSwgUGFnZSB9IGZyb20gJ3B1cHBldGVlcic7XG5pbXBvcnQgeyBCYXNlU2NyYXBlcldpdGhCcm93c2VyLCBMb2dpbk9wdGlvbnMsIExvZ2luUmVzdWx0cyB9IGZyb20gJy4vYmFzZS1zY3JhcGVyLXdpdGgtYnJvd3Nlcic7XG5pbXBvcnQge1xuICBjbGlja0J1dHRvbiwgZWxlbWVudFByZXNlbnRPblBhZ2UsIHBhZ2VFdmFsLCBwYWdlRXZhbEFsbCwgc2V0VmFsdWUsIHdhaXRVbnRpbEVsZW1lbnRGb3VuZCxcbn0gZnJvbSAnLi4vaGVscGVycy9lbGVtZW50cy1pbnRlcmFjdGlvbnMnO1xuaW1wb3J0IHtcbiAgVHJhbnNhY3Rpb24sXG4gIFRyYW5zYWN0aW9uSW5zdGFsbG1lbnRzLFxuICBUcmFuc2FjdGlvbnNBY2NvdW50LFxuICBUcmFuc2FjdGlvblN0YXR1c2VzLFxuICBUcmFuc2FjdGlvblR5cGVzLFxufSBmcm9tICcuLi90cmFuc2FjdGlvbnMnO1xuaW1wb3J0IHsgU2NyYXBlck9wdGlvbnMsIFNjYXBlclNjcmFwaW5nUmVzdWx0LCBTY3JhcGVyQ3JlZGVudGlhbHMgfSBmcm9tICcuL2Jhc2Utc2NyYXBlcic7XG5pbXBvcnQge1xuICBET0xMQVJfQ1VSUkVOQ1ksIERPTExBUl9DVVJSRU5DWV9TWU1CT0wsIEVVUk9fQ1VSUkVOQ1ksIEVVUk9fQ1VSUkVOQ1lfU1lNQk9MLCBTSEVLRUxfQ1VSUkVOQ1ksIFNIRUtFTF9DVVJSRU5DWV9TWU1CT0wsXG59IGZyb20gJy4uL2NvbnN0YW50cyc7XG5pbXBvcnQgeyB3YWl0VW50aWwgfSBmcm9tICcuLi9oZWxwZXJzL3dhaXRpbmcnO1xuaW1wb3J0IHsgZmlsdGVyT2xkVHJhbnNhY3Rpb25zIH0gZnJvbSAnLi4vaGVscGVycy90cmFuc2FjdGlvbnMnO1xuaW1wb3J0IHsgZ2V0RGVidWcgfSBmcm9tICcuLi9oZWxwZXJzL2RlYnVnJztcbmltcG9ydCB7IGZldGNoUG9zdFdpdGhpblBhZ2UgfSBmcm9tICcuLi9oZWxwZXJzL2ZldGNoJztcblxuY29uc3QgTE9HSU5fVVJMID0gJ2h0dHBzOi8vd3d3LmNhbC1vbmxpbmUuY28uaWwvJztcbmNvbnN0IFRSQU5TQUNUSU9OU19VUkwgPSAnaHR0cHM6Ly9zZXJ2aWNlcy5jYWwtb25saW5lLmNvLmlsL0NhcmQtSG9sZGVycy9TY3JlZW5zL1RyYW5zYWN0aW9ucy9UcmFuc2FjdGlvbnMuYXNweCc7XG5jb25zdCBHRVRfVFhfREVUQUlMU19VUkwgPSAnaHR0cHM6Ly9zZXJ2aWNlcy5jYWwtb25saW5lLmNvLmlsL0NhcmQtSG9sZGVycy9TQ1JFRU5TL1RyYW5zYWN0aW9ucy9UcmFuc2FjdGlvbnMuYXNweC9HZXRUcmFuc0RldGFpbHMnO1xuY29uc3QgR0VUX1RYX0RFVEFJTFNfSEVBREVSID0geyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb247Y2hhcnNldD1VVEYtOCcgfTtcbmNvbnN0IExPTkdfREFURV9GT1JNQVQgPSAnREQvTU0vWVlZWSc7XG5jb25zdCBEQVRFX0ZPUk1BVCA9ICdERC9NTS9ZWSc7XG5jb25zdCBJbnZhbGlkUGFzc3dvcmRNZXNzYWdlID0gJ9ep150g15TXntep16rXntepINeQ15Ug15TXodeZ16HXnteUINep15TXldeW16DXlSDXqdeS15XXmdeZ150nO1xuXG5jb25zdCBkZWJ1ZyA9IGdldERlYnVnKCd2aXNhLWNhbCcpO1xuXG5pbnRlcmZhY2UgU2NyYXBlZFRyYW5zYWN0aW9uIHtcbiAgb25jbGljazogc3RyaW5nIHwgbnVsbDtcbiAgZGF0ZTogc3RyaW5nO1xuICBwcm9jZXNzZWREYXRlOiBzdHJpbmc7XG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG4gIG9yaWdpbmFsQW1vdW50OiBzdHJpbmc7XG4gIGNoYXJnZWRBbW91bnQ6IHN0cmluZztcbiAgbWVtbzogc3RyaW5nO1xuICBhZGRpdGlvbmFsSW5mbz86IFNjcmFwZWRBZGRpdGlvbmFsSW5mbztcbn1cblxuaW50ZXJmYWNlIFNjcmFwZWRBZGRpdGlvbmFsSW5mbyB7XG4gIGNhdGVnb3J5Pzogc3RyaW5nO1xufVxuXG5cbmFzeW5jIGZ1bmN0aW9uIGdldExvZ2luRnJhbWUocGFnZTogUGFnZSkge1xuICBsZXQgZnJhbWU6IEZyYW1lIHwgbnVsbCA9IG51bGw7XG4gIGRlYnVnKCd3YWl0IHVudGlsIGxvZ2luIGZyYW1lIGZvdW5kJyk7XG4gIGF3YWl0IHdhaXRVbnRpbCgoKSA9PiB7XG4gICAgZnJhbWUgPSBwYWdlXG4gICAgICAuZnJhbWVzKClcbiAgICAgIC5maW5kKChmKSA9PiBmLnVybCgpLmluY2x1ZGVzKCdjYWxjb25uZWN0JykpIHx8IG51bGw7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSghIWZyYW1lKTtcbiAgfSwgJ3dhaXQgZm9yIGlmcmFtZSB3aXRoIGxvZ2luIGZvcm0nLCAxMDAwMCwgMTAwMCk7XG5cbiAgaWYgKCFmcmFtZSkge1xuICAgIGRlYnVnKCdmYWlsZWQgdG8gZmluZCBsb2dpbiBmcmFtZSBmb3IgMTAgc2Vjb25kcycpO1xuICAgIHRocm93IG5ldyBFcnJvcignZmFpbGVkIHRvIGV4dHJhY3QgbG9naW4gaWZyYW1lJyk7XG4gIH1cblxuICByZXR1cm4gZnJhbWU7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhc0ludmFsaWRQYXNzd29yZEVycm9yKHBhZ2U6IFBhZ2UpIHtcbiAgY29uc3QgZnJhbWUgPSBhd2FpdCBnZXRMb2dpbkZyYW1lKHBhZ2UpO1xuICBjb25zdCBlcnJvckZvdW5kID0gYXdhaXQgZWxlbWVudFByZXNlbnRPblBhZ2UoZnJhbWUsICdkaXYuZ2VuZXJhbC1lcnJvciA+IGRpdicpO1xuICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvckZvdW5kID8gYXdhaXQgcGFnZUV2YWwoZnJhbWUsICdkaXYuZ2VuZXJhbC1lcnJvciA+IGRpdicsICcnLCAoaXRlbSkgPT4ge1xuICAgIHJldHVybiAoaXRlbSBhcyBIVE1MRGl2RWxlbWVudCkuaW5uZXJUZXh0O1xuICB9KSA6ICcnO1xuICByZXR1cm4gZXJyb3JNZXNzYWdlID09PSBJbnZhbGlkUGFzc3dvcmRNZXNzYWdlO1xufVxuXG5mdW5jdGlvbiBnZXRQb3NzaWJsZUxvZ2luUmVzdWx0cygpIHtcbiAgZGVidWcoJ3JldHVybiBwb3NzaWJsZSBsb2dpbiByZXN1bHRzJyk7XG4gIGNvbnN0IHVybHM6IExvZ2luT3B0aW9uc1sncG9zc2libGVSZXN1bHRzJ10gPSB7XG4gICAgW0xvZ2luUmVzdWx0cy5TdWNjZXNzXTogWy9BY2NvdW50TWFuYWdlbWVudC9pXSxcbiAgICBbTG9naW5SZXN1bHRzLkludmFsaWRQYXNzd29yZF06IFthc3luYyAob3B0aW9ucz86IHsgcGFnZT86IFBhZ2V9KSA9PiB7XG4gICAgICBjb25zdCBwYWdlID0gb3B0aW9ucz8ucGFnZTtcbiAgICAgIGlmICghcGFnZSkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICByZXR1cm4gaGFzSW52YWxpZFBhc3N3b3JkRXJyb3IocGFnZSk7XG4gICAgfV0sXG4gICAgLy8gW0xvZ2luUmVzdWx0cy5BY2NvdW50QmxvY2tlZF06IFtdLCAvLyBUT0RPIGFkZCB3aGVuIHJlYWNoaW5nIHRoaXMgc2NlbmFyaW9cbiAgICAvLyBbTG9naW5SZXN1bHRzLkNoYW5nZVBhc3N3b3JkXTogW10sIC8vIFRPRE8gYWRkIHdoZW4gcmVhY2hpbmcgdGhpcyBzY2VuYXJpb1xuICB9O1xuICByZXR1cm4gdXJscztcbn1cblxuZnVuY3Rpb24gY3JlYXRlTG9naW5GaWVsZHMoY3JlZGVudGlhbHM6IFNjcmFwZXJDcmVkZW50aWFscykge1xuICBkZWJ1ZygnY3JlYXRlIGxvZ2luIGZpZWxkcyBmb3IgdXNlcm5hbWUgYW5kIHBhc3N3b3JkJyk7XG4gIHJldHVybiBbXG4gICAgeyBzZWxlY3RvcjogJ1tmb3JtY29udHJvbG5hbWU9XCJ1c2VyTmFtZVwiXScsIHZhbHVlOiBjcmVkZW50aWFscy51c2VybmFtZSB9LFxuICAgIHsgc2VsZWN0b3I6ICdbZm9ybWNvbnRyb2xuYW1lPVwicGFzc3dvcmRcIl0nLCB2YWx1ZTogY3JlZGVudGlhbHMucGFzc3dvcmQgfSxcbiAgXTtcbn1cblxuXG5mdW5jdGlvbiBnZXRBbW91bnREYXRhKGFtb3VudFN0cjogc3RyaW5nKSB7XG4gIGNvbnN0IGFtb3VudFN0ckNsbiA9IGFtb3VudFN0ci5yZXBsYWNlKCcsJywgJycpO1xuICBsZXQgY3VycmVuY3k6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBsZXQgYW1vdW50OiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgaWYgKGFtb3VudFN0ckNsbi5pbmNsdWRlcyhTSEVLRUxfQ1VSUkVOQ1lfU1lNQk9MKSkge1xuICAgIGFtb3VudCA9IC1wYXJzZUZsb2F0KGFtb3VudFN0ckNsbi5yZXBsYWNlKFNIRUtFTF9DVVJSRU5DWV9TWU1CT0wsICcnKSk7XG4gICAgY3VycmVuY3kgPSBTSEVLRUxfQ1VSUkVOQ1k7XG4gIH0gZWxzZSBpZiAoYW1vdW50U3RyQ2xuLmluY2x1ZGVzKERPTExBUl9DVVJSRU5DWV9TWU1CT0wpKSB7XG4gICAgYW1vdW50ID0gLXBhcnNlRmxvYXQoYW1vdW50U3RyQ2xuLnJlcGxhY2UoRE9MTEFSX0NVUlJFTkNZX1NZTUJPTCwgJycpKTtcbiAgICBjdXJyZW5jeSA9IERPTExBUl9DVVJSRU5DWTtcbiAgfSBlbHNlIGlmIChhbW91bnRTdHJDbG4uaW5jbHVkZXMoRVVST19DVVJSRU5DWV9TWU1CT0wpKSB7XG4gICAgYW1vdW50ID0gLXBhcnNlRmxvYXQoYW1vdW50U3RyQ2xuLnJlcGxhY2UoRVVST19DVVJSRU5DWV9TWU1CT0wsICcnKSk7XG4gICAgY3VycmVuY3kgPSBFVVJPX0NVUlJFTkNZO1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IHBhcnRzID0gYW1vdW50U3RyQ2xuLnNwbGl0KCcgJyk7XG4gICAgW2N1cnJlbmN5XSA9IHBhcnRzO1xuICAgIGFtb3VudCA9IC1wYXJzZUZsb2F0KHBhcnRzWzFdKTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgYW1vdW50LFxuICAgIGN1cnJlbmN5LFxuICB9O1xufVxuXG5mdW5jdGlvbiBnZXRUcmFuc2FjdGlvbkluc3RhbGxtZW50cyhtZW1vOiBzdHJpbmcpOiBUcmFuc2FjdGlvbkluc3RhbGxtZW50cyB8IG51bGwge1xuICBjb25zdCBwYXJzZWRNZW1vID0gKC/Xqtep15zXldedIChcXGQrKSDXnteq15XXmiAoXFxkKykvKS5leGVjKG1lbW8gfHwgJycpO1xuXG4gIGlmICghcGFyc2VkTWVtbyB8fCBwYXJzZWRNZW1vLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBudW1iZXI6IHBhcnNlSW50KHBhcnNlZE1lbW9bMV0sIDEwKSxcbiAgICB0b3RhbDogcGFyc2VJbnQocGFyc2VkTWVtb1syXSwgMTApLFxuICB9O1xufVxuXG5mdW5jdGlvbiBnZXRJZGVudGlmaWVyQW5kTnVtZXJhdG9yKG9uY2xpY2tWYWx1ZTogc3RyaW5nIHwgbnVsbCk6IHsgaWRlbnRpZmllcj86IHN0cmluZywgbnVtZXJhdG9yPzogc3RyaW5nIH0ge1xuICBpZiAoIW9uY2xpY2tWYWx1ZSkge1xuICAgIGRlYnVnKCdjYW5ub3QgZXh0cmFjdCB0aGUgaWRlbnRpZmllciBvZiBhIHRyYW5zYWN0aW9uLCBvbmNsaWNrIGF0dHJpYnV0ZSBub3QgZm91bmQgZm9yIHRyYW5zYWN0aW9uJyk7XG4gICAgcmV0dXJuIHt9O1xuICB9XG4gIGNvbnN0IGV4cGVjdGVkU3RhcnRWYWx1ZSA9ICdPbk1vdXNlQ2xpY2tSb3codGhpcywgZXZlbnQsIFwiJztcbiAgaWYgKCFvbmNsaWNrVmFsdWUuc3RhcnRzV2l0aChleHBlY3RlZFN0YXJ0VmFsdWUpKSB7XG4gICAgZGVidWcoYGNhbm5vdCBleHRyYWN0IHRoZSBpZGVudGlmaWVyIG9mIGEgdHJhbnNhY3Rpb24sIG9uY2xpY2sgYXR0cmlidXRlIHZhbHVlIGRvZXNudCBzdGFydCB3aXRoIGV4cGVjdGVkIHZhbHVlICcke29uY2xpY2tWYWx1ZX0nYCk7XG4gICAgcmV0dXJuIHt9O1xuICB9XG5cbiAgY29uc3QgdGhpcmRBcmd1bWVudCA9IG9uY2xpY2tWYWx1ZS5zdWJzdHJpbmcoZXhwZWN0ZWRTdGFydFZhbHVlLmxlbmd0aCwgb25jbGlja1ZhbHVlLmxlbmd0aCAtIDIpO1xuICBjb25zdCBzcGxpdHMgPSB0aGlyZEFyZ3VtZW50LnNwbGl0KCd8Jyk7XG4gIGlmIChzcGxpdHMubGVuZ3RoICE9PSAyKSB7XG4gICAgZGVidWcoYGNhbm5vdCBleHRyYWN0IHRoZSBpZGVudGlmaWVyIG9mIGEgdHJhbnNhY3Rpb24sIHVuZXhwZWN0ZWQgM3JkIGFyZ3VtZW50IGluIG9uY2xpY2sgdmFsdWUgJyR7b25jbGlja1ZhbHVlfSdgKTtcbiAgICByZXR1cm4ge307XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBpZGVudGlmaWVyOiBzcGxpdHNbMV0sXG4gICAgbnVtZXJhdG9yOiBzcGxpdHNbMF0sXG4gIH07XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRUcmFuc2FjdGlvbnModHhuczogU2NyYXBlZFRyYW5zYWN0aW9uW10pOiBUcmFuc2FjdGlvbltdIHtcbiAgZGVidWcoYGNvbnZlcnQgJHt0eG5zLmxlbmd0aH0gcmF3IHRyYW5zYWN0aW9ucyB0byBvZmZpY2lhbCBUcmFuc2FjdGlvbiBzdHJ1Y3R1cmVgKTtcbiAgcmV0dXJuIHR4bnMubWFwKCh0eG4pID0+IHtcbiAgICBjb25zdCBvcmlnaW5hbEFtb3VudFR1cGxlID0gZ2V0QW1vdW50RGF0YSh0eG4ub3JpZ2luYWxBbW91bnQgfHwgJycpO1xuICAgIGNvbnN0IGNoYXJnZWRBbW91bnRUdXBsZSA9IGdldEFtb3VudERhdGEodHhuLmNoYXJnZWRBbW91bnQgfHwgJycpO1xuXG4gICAgY29uc3QgaW5zdGFsbG1lbnRzID0gZ2V0VHJhbnNhY3Rpb25JbnN0YWxsbWVudHModHhuLm1lbW8pO1xuICAgIGNvbnN0IHR4bkRhdGUgPSBtb21lbnQodHhuLmRhdGUsIERBVEVfRk9STUFUKTtcbiAgICBjb25zdCBwcm9jZXNzZWREYXRlRm9ybWF0ID1cbiAgICAgIHR4bi5wcm9jZXNzZWREYXRlLmxlbmd0aCA9PT0gOCA/XG4gICAgICAgIERBVEVfRk9STUFUIDpcbiAgICAgICAgdHhuLnByb2Nlc3NlZERhdGUubGVuZ3RoID09PSA5IHx8IHR4bi5wcm9jZXNzZWREYXRlLmxlbmd0aCA9PT0gMTAgP1xuICAgICAgICAgIExPTkdfREFURV9GT1JNQVQgOlxuICAgICAgICAgIG51bGw7XG4gICAgaWYgKCFwcm9jZXNzZWREYXRlRm9ybWF0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ2ludmFsaWQgcHJvY2Vzc2VkIGRhdGUnKTtcbiAgICB9XG4gICAgY29uc3QgdHhuUHJvY2Vzc2VkRGF0ZSA9IG1vbWVudCh0eG4ucHJvY2Vzc2VkRGF0ZSwgcHJvY2Vzc2VkRGF0ZUZvcm1hdCk7XG5cbiAgICBjb25zdCByZXN1bHQ6IFRyYW5zYWN0aW9uID0ge1xuICAgICAgaWRlbnRpZmllcjogZ2V0SWRlbnRpZmllckFuZE51bWVyYXRvcih0eG4ub25jbGljayk/LmlkZW50aWZpZXIsXG4gICAgICB0eXBlOiBpbnN0YWxsbWVudHMgPyBUcmFuc2FjdGlvblR5cGVzLkluc3RhbGxtZW50cyA6IFRyYW5zYWN0aW9uVHlwZXMuTm9ybWFsLFxuICAgICAgc3RhdHVzOiBUcmFuc2FjdGlvblN0YXR1c2VzLkNvbXBsZXRlZCxcbiAgICAgIGRhdGU6IGluc3RhbGxtZW50cyA/IHR4bkRhdGUuYWRkKGluc3RhbGxtZW50cy5udW1iZXIgLSAxLCAnbW9udGgnKS50b0lTT1N0cmluZygpIDogdHhuRGF0ZS50b0lTT1N0cmluZygpLFxuICAgICAgcHJvY2Vzc2VkRGF0ZTogdHhuUHJvY2Vzc2VkRGF0ZS50b0lTT1N0cmluZygpLFxuICAgICAgb3JpZ2luYWxBbW91bnQ6IG9yaWdpbmFsQW1vdW50VHVwbGUuYW1vdW50LFxuICAgICAgb3JpZ2luYWxDdXJyZW5jeTogb3JpZ2luYWxBbW91bnRUdXBsZS5jdXJyZW5jeSxcbiAgICAgIGNoYXJnZWRBbW91bnQ6IGNoYXJnZWRBbW91bnRUdXBsZS5hbW91bnQsXG4gICAgICBjaGFyZ2VkQ3VycmVuY3k6IGNoYXJnZWRBbW91bnRUdXBsZS5jdXJyZW5jeSxcbiAgICAgIGRlc2NyaXB0aW9uOiB0eG4uZGVzY3JpcHRpb24gfHwgJycsXG4gICAgICBtZW1vOiB0eG4ubWVtbyB8fCAnJyxcbiAgICAgIGNhdGVnb3J5OiB0eG4uYWRkaXRpb25hbEluZm8/LmNhdGVnb3J5LFxuICAgIH07XG5cbiAgICBpZiAoaW5zdGFsbG1lbnRzKSB7XG4gICAgICByZXN1bHQuaW5zdGFsbG1lbnRzID0gaW5zdGFsbG1lbnRzO1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRBZGRpdGlvbmFsVHhJbmZvKHR4OiBTY3JhcGVkVHJhbnNhY3Rpb24sIHBhZ2U6IFBhZ2UpOiBQcm9taXNlPFNjcmFwZWRBZGRpdGlvbmFsSW5mbyB8IG51bGw+IHtcbiAgY29uc3QgeyBpZGVudGlmaWVyLCBudW1lcmF0b3IgfSA9IGdldElkZW50aWZpZXJBbmROdW1lcmF0b3IodHgub25jbGljayk7XG4gIGlmIChpZGVudGlmaWVyID09PSB1bmRlZmluZWQgfHwgbnVtZXJhdG9yID09PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBjb25zdCByZXN1bHQgPSBhd2FpdCBmZXRjaFBvc3RXaXRoaW5QYWdlPGFueT4ocGFnZSwgR0VUX1RYX0RFVEFJTFNfVVJMLCB7XG4gICAgSWRlbnRpZmllcjogaWRlbnRpZmllcixcbiAgICBOdW1lcmF0b3I6IG51bWVyYXRvcixcbiAgfSwgR0VUX1RYX0RFVEFJTFNfSEVBREVSKTtcblxuICByZXR1cm4ge1xuICAgIGNhdGVnb3J5OiByZXN1bHQuZD8uRGF0YT8uTWVyY2hhbnREZXRhaWxzPy5TZWN0b3JOYW1lIHx8IHVuZGVmaW5lZCxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0QWRkaXRpb25hbFR4c0luZm9JZk5lZWRlZCh0eHM6IFNjcmFwZWRUcmFuc2FjdGlvbltdLCBzY3JhcGVyT3B0aW9uczogU2NyYXBlck9wdGlvbnMsIHBhZ2U6IFBhZ2UpOiBQcm9taXNlPFNjcmFwZWRUcmFuc2FjdGlvbltdPiB7XG4gIGlmICghc2NyYXBlck9wdGlvbnMuYWRkaXRpb25hbFRyYW5zYWN0aW9uSW5mb3JtYXRpb24pIHtcbiAgICByZXR1cm4gdHhzO1xuICB9XG4gIGNvbnN0IHByb21pc2VzID0gdHhzLm1hcChhc3luYyAoeCkgPT4gKHtcbiAgICAuLi54LFxuICAgIGFkZGl0aW9uYWxJbmZvOiBhd2FpdCBnZXRBZGRpdGlvbmFsVHhJbmZvKHgsIHBhZ2UpLFxuICB9KSBhcyBTY3JhcGVkVHJhbnNhY3Rpb24pO1xuICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaFRyYW5zYWN0aW9uc0ZvckFjY291bnQocGFnZTogUGFnZSwgc3RhcnREYXRlOiBNb21lbnQsIGFjY291bnROdW1iZXI6IHN0cmluZywgc2NyYXBlck9wdGlvbnM6IFNjcmFwZXJPcHRpb25zKTogUHJvbWlzZTxUcmFuc2FjdGlvbnNBY2NvdW50PiB7XG4gIGNvbnN0IHN0YXJ0RGF0ZVZhbHVlID0gc3RhcnREYXRlLmZvcm1hdCgnTU0vWVlZWScpO1xuICBjb25zdCBkYXRlU2VsZWN0b3IgPSAnW2lkJD1cIkZvcm1BcmVhTm9Cb3JkZXJfRm9ybUFyZWFfY2xuZHJEZWJpdERhdGVTY29wZV9UZXh0Qm94XCJdJztcbiAgY29uc3QgZGF0ZUhpZGRlbkZpZWxkU2VsZWN0b3IgPSAnW2lkJD1cIkZvcm1BcmVhTm9Cb3JkZXJfRm9ybUFyZWFfY2xuZHJEZWJpdERhdGVTY29wZV9IaWRkZW5GaWVsZFwiXSc7XG4gIGNvbnN0IGJ1dHRvblNlbGVjdG9yID0gJ1tpZCQ9XCJGb3JtQXJlYU5vQm9yZGVyX0Zvcm1BcmVhX2N0bFN1Ym1pdFJlcXVlc3RcIl0nO1xuICBjb25zdCBuZXh0UGFnZVNlbGVjdG9yID0gJ1tpZCQ9XCJGb3JtQXJlYU5vQm9yZGVyX0Zvcm1BcmVhX2N0bEdyaWRQYWdlcl9idG5OZXh0XCJdJztcbiAgY29uc3QgYmlsbGluZ0xhYmVsU2VsZWN0b3IgPSAnW2lkJD1Gb3JtQXJlYU5vQm9yZGVyX0Zvcm1BcmVhX2N0bE1haW5Ub29sQmFyX2xibENhcHRpb25dJztcbiAgY29uc3Qgc2Vjb25kYXJ5QmlsbGluZ0xhYmVsU2VsZWN0b3IgPSAnW2lkJD1Gb3JtQXJlYU5vQm9yZGVyX0Zvcm1BcmVhX2N0bFNlY29uZGFyeVRvb2xCYXJfbGJsQ2FwdGlvbl0nO1xuICBjb25zdCBub0RhdGFTZWxlY3RvciA9ICdbaWQkPUZvcm1BcmVhTm9Cb3JkZXJfRm9ybUFyZWFfbXNnYm94RXJyb3JNZXNzYWdlc10nO1xuXG4gIGRlYnVnKCdmaW5kIHRoZSBzdGFydCBkYXRlIGluZGV4IGluIHRoZSBkcm9wYm94Jyk7XG4gIGNvbnN0IG9wdGlvbnMgPSBhd2FpdCBwYWdlRXZhbEFsbChwYWdlLCAnW2lkJD1cIkZvcm1BcmVhTm9Cb3JkZXJfRm9ybUFyZWFfY2xuZHJEZWJpdERhdGVTY29wZV9PcHRpb25MaXN0XCJdIGxpJywgW10sIChpdGVtcykgPT4ge1xuICAgIHJldHVybiBpdGVtcy5tYXAoKGVsOiBhbnkpID0+IGVsLmlubmVyVGV4dCk7XG4gIH0pO1xuICBjb25zdCBzdGFydERhdGVJbmRleCA9IG9wdGlvbnMuZmluZEluZGV4KChvcHRpb24pID0+IG9wdGlvbiA9PT0gc3RhcnREYXRlVmFsdWUpO1xuXG4gIGRlYnVnKGBzY3JhcGUgJHtvcHRpb25zLmxlbmd0aCAtIHN0YXJ0RGF0ZUluZGV4fSBiaWxsaW5nIGN5Y2xlc2ApO1xuICBjb25zdCBhY2NvdW50VHJhbnNhY3Rpb25zOiBUcmFuc2FjdGlvbltdID0gW107XG4gIGZvciAobGV0IGN1cnJlbnREYXRlSW5kZXggPSBzdGFydERhdGVJbmRleDsgY3VycmVudERhdGVJbmRleCA8IG9wdGlvbnMubGVuZ3RoOyBjdXJyZW50RGF0ZUluZGV4ICs9IDEpIHtcbiAgICBkZWJ1Zygnd2FpdCBmb3IgZGF0ZSBzZWxlY3RvciB0byBiZSBmb3VuZCcpO1xuICAgIGF3YWl0IHdhaXRVbnRpbEVsZW1lbnRGb3VuZChwYWdlLCBkYXRlU2VsZWN0b3IsIHRydWUpO1xuICAgIGRlYnVnKGBzZXQgaGlkZGVuIHZhbHVlIG9mIHRoZSBkYXRlIHNlbGVjdG9yIHRvIGJlIHRoZSBpbmRleCAke2N1cnJlbnREYXRlSW5kZXh9YCk7XG4gICAgYXdhaXQgc2V0VmFsdWUocGFnZSwgZGF0ZUhpZGRlbkZpZWxkU2VsZWN0b3IsIGAke2N1cnJlbnREYXRlSW5kZXh9YCk7XG4gICAgZGVidWcoJ3dhaXQgYSBzZWNvbmQgdG8gd29ya2Fyb3VuZCBuYXZpZ2F0aW9uIGlzc3VlIGluIGhlYWRsZXNzIGJyb3dzZXIgbW9kZScpO1xuICAgIGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoMTAwMCk7XG4gICAgZGVidWcoJ2NsaWNrIG9uIHRoZSBmaWx0ZXIgc3VibWl0IGJ1dHRvbiBhbmQgd2FpdCBmb3IgbmF2aWdhdGlvbicpO1xuICAgIGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgIHBhZ2Uud2FpdEZvck5hdmlnYXRpb24oeyB3YWl0VW50aWw6ICdkb21jb250ZW50bG9hZGVkJyB9KSxcbiAgICAgIGNsaWNrQnV0dG9uKHBhZ2UsIGJ1dHRvblNlbGVjdG9yKSxcbiAgICBdKTtcbiAgICBkZWJ1ZygnY2hlY2sgaWYgbW9udGggaGFzIG5vIHRyYW5zYWN0aW9ucycpO1xuICAgIGNvbnN0IHBhZ2VIYXNOb1RyYW5zYWN0aW9ucyA9IGF3YWl0IHBhZ2VFdmFsKHBhZ2UsIG5vRGF0YVNlbGVjdG9yLCBmYWxzZSwgKChlbGVtZW50KSA9PiB7XG4gICAgICBjb25zdCBzaXRlVmFsdWUgPSAoKGVsZW1lbnQgYXMgSFRNTFNwYW5FbGVtZW50KS5pbm5lclRleHQgfHwgJycpLnJlcGxhY2UoL1teINeQLdeqXS9nLCAnJyk7XG4gICAgICByZXR1cm4gc2l0ZVZhbHVlID09PSAn15zXkCDXoNee16bXkNeVINeg16rXldeg15nXnSc7XG4gICAgfSkpO1xuXG4gICAgaWYgKHBhZ2VIYXNOb1RyYW5zYWN0aW9ucykge1xuICAgICAgZGVidWcoJ3BhZ2UgaGFzIG5vIHRyYW5zYWN0aW9ucycpO1xuICAgIH0gZWxzZSB7XG4gICAgICBkZWJ1ZygnZmluZCB0aGUgYmlsbGluZyBkYXRlJyk7XG4gICAgICBsZXQgYmlsbGluZ0RhdGVMYWJlbCA9IGF3YWl0IHBhZ2VFdmFsKHBhZ2UsIGJpbGxpbmdMYWJlbFNlbGVjdG9yLCAnJywgKChlbGVtZW50KSA9PiB7XG4gICAgICAgIHJldHVybiAoZWxlbWVudCBhcyBIVE1MU3BhbkVsZW1lbnQpLmlubmVyVGV4dDtcbiAgICAgIH0pKTtcbiAgICAgIGxldCBzZXR0bGVtZW50RGF0ZVJlZ2V4ID0gL1xcZHsxLDJ9Wy9dXFxkezJ9Wy9dXFxkezIsNH0vO1xuXG4gICAgICBpZiAoYmlsbGluZ0RhdGVMYWJlbCA9PT0gJycpIHtcbiAgICAgICAgYmlsbGluZ0RhdGVMYWJlbCA9IGF3YWl0IHBhZ2VFdmFsKHBhZ2UsIHNlY29uZGFyeUJpbGxpbmdMYWJlbFNlbGVjdG9yLCAnJywgKChlbGVtZW50KSA9PiB7XG4gICAgICAgICAgcmV0dXJuIChlbGVtZW50IGFzIEhUTUxTcGFuRWxlbWVudCkuaW5uZXJUZXh0O1xuICAgICAgICB9KSk7XG4gICAgICAgIHNldHRsZW1lbnREYXRlUmVnZXggPSAvXFxkezEsMn1bL11cXGR7Miw0fS87XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGJpbGxpbmdEYXRlID0gc2V0dGxlbWVudERhdGVSZWdleC5leGVjKGJpbGxpbmdEYXRlTGFiZWwpPy5bMF07XG5cbiAgICAgIGlmICghYmlsbGluZ0RhdGUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdmYWlsZWQgdG8gZmV0Y2ggcHJvY2VzcyBkYXRlJyk7XG4gICAgICB9XG5cbiAgICAgIGRlYnVnKGBmb3VuZCB0aGUgYmlsbGluZyBkYXRlIGZvciB0aGF0IG1vbnRoICR7YmlsbGluZ0RhdGV9YCk7XG4gICAgICBsZXQgaGFzTmV4dFBhZ2UgPSBmYWxzZTtcbiAgICAgIGRvIHtcbiAgICAgICAgZGVidWcoJ2ZldGNoIHJhdyB0cmFuc2FjdGlvbnMgZnJvbSBwYWdlJyk7XG4gICAgICAgIGNvbnN0IHJhd1RyYW5zYWN0aW9ucyA9IGF3YWl0IHBhZ2VFdmFsQWxsPChTY3JhcGVkVHJhbnNhY3Rpb24gfCBudWxsKVtdPihwYWdlLCAnI2N0bE1haW5HcmlkID4gdGJvZHkgdHIsICNjdGxTZWNvbmRhcnlHcmlkID4gdGJvZHkgdHInLCBbXSwgKGl0ZW1zLCBiaWxsaW5nRGF0ZSkgPT4ge1xuICAgICAgICAgIHJldHVybiAoaXRlbXMpLm1hcCgoZWwpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGNvbHVtbnMgPSBlbC5nZXRFbGVtZW50c0J5VGFnTmFtZSgndGQnKTtcbiAgICAgICAgICAgIGNvbnN0IG9uY2xpY2sgPSBlbC5nZXRBdHRyaWJ1dGUoJ29uY2xpY2snKTtcbiAgICAgICAgICAgIGlmIChjb2x1bW5zLmxlbmd0aCA9PT0gNikge1xuICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIG9uY2xpY2ssXG4gICAgICAgICAgICAgICAgcHJvY2Vzc2VkRGF0ZTogY29sdW1uc1swXS5pbm5lclRleHQsXG4gICAgICAgICAgICAgICAgZGF0ZTogY29sdW1uc1sxXS5pbm5lclRleHQsXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IGNvbHVtbnNbMl0uaW5uZXJUZXh0LFxuICAgICAgICAgICAgICAgIG9yaWdpbmFsQW1vdW50OiBjb2x1bW5zWzNdLmlubmVyVGV4dCxcbiAgICAgICAgICAgICAgICBjaGFyZ2VkQW1vdW50OiBjb2x1bW5zWzRdLmlubmVyVGV4dCxcbiAgICAgICAgICAgICAgICBtZW1vOiBjb2x1bW5zWzVdLmlubmVyVGV4dCxcbiAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjb2x1bW5zLmxlbmd0aCA9PT0gNSkge1xuICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgIG9uY2xpY2ssXG4gICAgICAgICAgICAgICAgcHJvY2Vzc2VkRGF0ZTogYmlsbGluZ0RhdGUsXG4gICAgICAgICAgICAgICAgZGF0ZTogY29sdW1uc1swXS5pbm5lclRleHQsXG4gICAgICAgICAgICAgICAgZGVzY3JpcHRpb246IGNvbHVtbnNbMV0uaW5uZXJUZXh0LFxuICAgICAgICAgICAgICAgIG9yaWdpbmFsQW1vdW50OiBjb2x1bW5zWzJdLmlubmVyVGV4dCxcbiAgICAgICAgICAgICAgICBjaGFyZ2VkQW1vdW50OiBjb2x1bW5zWzNdLmlubmVyVGV4dCxcbiAgICAgICAgICAgICAgICBtZW1vOiBjb2x1bW5zWzRdLmlubmVyVGV4dCxcbiAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9LCBiaWxsaW5nRGF0ZSk7XG4gICAgICAgIGRlYnVnKGBmZXRjaGVkICR7cmF3VHJhbnNhY3Rpb25zLmxlbmd0aH0gcmF3IHRyYW5zYWN0aW9ucyBmcm9tIHBhZ2VgKTtcbiAgICAgICAgY29uc3QgZXhpc3RzVHhzID0gKHJhd1RyYW5zYWN0aW9ucyBhcyBTY3JhcGVkVHJhbnNhY3Rpb25bXSlcbiAgICAgICAgICAuZmlsdGVyKChpdGVtKSA9PiAhIWl0ZW0pO1xuICAgICAgICBjb25zdCBmdWxsU2NyYXBwZWRUeHMgPSBhd2FpdCBnZXRBZGRpdGlvbmFsVHhzSW5mb0lmTmVlZGVkKGV4aXN0c1R4cywgc2NyYXBlck9wdGlvbnMsIHBhZ2UpO1xuXG4gICAgICAgIGFjY291bnRUcmFuc2FjdGlvbnMucHVzaCguLi5jb252ZXJ0VHJhbnNhY3Rpb25zKGZ1bGxTY3JhcHBlZFR4cykpO1xuXG4gICAgICAgIGRlYnVnKCdjaGVjayBmb3IgZXhpc3RlbmNlIG9mIGFub3RoZXIgcGFnZScpO1xuICAgICAgICBoYXNOZXh0UGFnZSA9IGF3YWl0IGVsZW1lbnRQcmVzZW50T25QYWdlKHBhZ2UsIG5leHRQYWdlU2VsZWN0b3IpO1xuICAgICAgICBpZiAoaGFzTmV4dFBhZ2UpIHtcbiAgICAgICAgICBkZWJ1ZygnaGFzIGFub3RoZXIgcGFnZSwgY2xpY2sgb24gYnV0dG9uIG5leHQgYW5kIHdhaXQgZm9yIHBhZ2UgbmF2aWdhdGlvbicpO1xuICAgICAgICAgIGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICAgICAgICAgIHBhZ2Uud2FpdEZvck5hdmlnYXRpb24oeyB3YWl0VW50aWw6ICdkb21jb250ZW50bG9hZGVkJyB9KSxcbiAgICAgICAgICAgIGF3YWl0IGNsaWNrQnV0dG9uKHBhZ2UsICdbaWQkPUZvcm1BcmVhTm9Cb3JkZXJfRm9ybUFyZWFfY3RsR3JpZFBhZ2VyX2J0bk5leHRdJyksXG4gICAgICAgICAgXSk7XG4gICAgICAgIH1cbiAgICAgIH0gd2hpbGUgKGhhc05leHRQYWdlKTtcbiAgICB9XG4gIH1cblxuICBkZWJ1ZygnZmlsZXIgb3V0IG9sZCB0cmFuc2FjdGlvbnMnKTtcbiAgY29uc3QgdHhucyA9IChzY3JhcGVyT3B0aW9ucy5vdXRwdXREYXRhPy5lbmFibGVUcmFuc2FjdGlvbnNGaWx0ZXJCeURhdGUgPz8gdHJ1ZSkgP1xuICAgIGZpbHRlck9sZFRyYW5zYWN0aW9ucyhhY2NvdW50VHJhbnNhY3Rpb25zLCBzdGFydERhdGUsIHNjcmFwZXJPcHRpb25zLmNvbWJpbmVJbnN0YWxsbWVudHMgfHwgZmFsc2UpIDpcbiAgICBhY2NvdW50VHJhbnNhY3Rpb25zO1xuICBkZWJ1ZyhgZm91bmQgJHt0eG5zLmxlbmd0aH0gdmFsaWQgdHJhbnNhY3Rpb25zIG91dCBvZiAke2FjY291bnRUcmFuc2FjdGlvbnMubGVuZ3RofSB0cmFuc2FjdGlvbnMgZm9yIGFjY291bnQgZW5kaW5nIHdpdGggJHthY2NvdW50TnVtYmVyLnN1YnN0cmluZyhhY2NvdW50TnVtYmVyLmxlbmd0aCAtIDIpfWApO1xuICByZXR1cm4ge1xuICAgIGFjY291bnROdW1iZXIsXG4gICAgdHhucyxcbiAgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0QWNjb3VudE51bWJlcnMocGFnZTogUGFnZSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgcmV0dXJuIHBhZ2VFdmFsQWxsKHBhZ2UsICdbaWQkPWxua0l0ZW1dJywgW10sIChlbGVtZW50cykgPT4gZWxlbWVudHMubWFwKChlKSA9PiAoZSBhcyBIVE1MQW5jaG9yRWxlbWVudCkudGV4dCkpLnRoZW4oKHJlcykgPT4gcmVzLm1hcCgodGV4dCkgPT4gL1xcZCskLy5leGVjKHRleHQudHJpbSgpKT8uWzBdID8/ICcnKSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNldEFjY291bnQocGFnZTogUGFnZSwgYWNjb3VudDogc3RyaW5nKSB7XG4gIGF3YWl0IHBhZ2VFdmFsQWxsKFxuICAgIHBhZ2UsXG4gICAgJ1tpZCQ9bG5rSXRlbV0nLFxuICAgIG51bGwsXG4gICAgKGVsZW1lbnRzLCBhY2NvdW50KSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IGVsZW0gb2YgZWxlbWVudHMpIHtcbiAgICAgICAgY29uc3QgYSA9IGVsZW0gYXMgSFRNTEFuY2hvckVsZW1lbnQ7XG4gICAgICAgIGlmIChhLnRleHQuaW5jbHVkZXMoYWNjb3VudCkpIHtcbiAgICAgICAgICBhLmNsaWNrKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuICAgIGFjY291bnQsXG4gICk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoVHJhbnNhY3Rpb25zKHBhZ2U6IFBhZ2UsIHN0YXJ0RGF0ZTogTW9tZW50LCBzY3JhcGVyT3B0aW9uczogU2NyYXBlck9wdGlvbnMpOiBQcm9taXNlPFRyYW5zYWN0aW9uc0FjY291bnRbXT4ge1xuICBjb25zdCBhY2NvdW50TnVtYmVyczogc3RyaW5nW10gPSBhd2FpdCBnZXRBY2NvdW50TnVtYmVycyhwYWdlKTtcbiAgY29uc3QgYWNjb3VudHM6IFRyYW5zYWN0aW9uc0FjY291bnRbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgYWNjb3VudCBvZiBhY2NvdW50TnVtYmVycykge1xuICAgIGRlYnVnKGBzZXR0aW5nIGFjY291bnQ6ICR7YWNjb3VudH1gKTtcbiAgICBhd2FpdCBzZXRBY2NvdW50KHBhZ2UsIGFjY291bnQpO1xuICAgIGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQoMTAwMCk7XG4gICAgYWNjb3VudHMucHVzaChcbiAgICAgIGF3YWl0IGZldGNoVHJhbnNhY3Rpb25zRm9yQWNjb3VudChcbiAgICAgICAgcGFnZSxcbiAgICAgICAgc3RhcnREYXRlLFxuICAgICAgICBhY2NvdW50LFxuICAgICAgICBzY3JhcGVyT3B0aW9ucyxcbiAgICAgICksXG4gICAgKTtcbiAgfVxuXG4gIHJldHVybiBhY2NvdW50cztcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hGdXR1cmVEZWJpdHMocGFnZTogUGFnZSkge1xuICBjb25zdCBmdXR1cmVEZWJpdHNTZWxlY3RvciA9ICcuaG9tZXBhZ2UtYmFua3MtdG9wJztcblxuICBjb25zdCByZXN1bHQgPSBhd2FpdCBwYWdlRXZhbEFsbChwYWdlLCBmdXR1cmVEZWJpdHNTZWxlY3RvciwgW10sIChpdGVtcykgPT4ge1xuICAgIGNvbnN0IGRlYml0TW91bnRDbGFzcyA9ICdhbW91bnQnO1xuICAgIGNvbnN0IGRlYml0V2hlbkNoYXJnZUNsYXNzID0gJ3doZW4tY2hhcmdlJztcbiAgICBjb25zdCBkZWJpdEJhbmtOdW1iZXJDbGFzcyA9ICdiYW5rRGVzYyc7XG5cbiAgICByZXR1cm4gaXRlbXMubWFwKChjdXJyQmFua0VsOiBhbnkpID0+IHtcbiAgICAgIGNvbnN0IGFtb3VudCA9IGN1cnJCYW5rRWwuZ2V0RWxlbWVudHNCeUNsYXNzTmFtZShkZWJpdE1vdW50Q2xhc3MpWzBdLmlubmVyVGV4dDtcbiAgICAgIGNvbnN0IHdoZW5DaGFyZ2UgPSBjdXJyQmFua0VsLmdldEVsZW1lbnRzQnlDbGFzc05hbWUoZGViaXRXaGVuQ2hhcmdlQ2xhc3MpWzBdLmlubmVyVGV4dDtcbiAgICAgIGNvbnN0IGJhbmtOdW1iZXIgPSBjdXJyQmFua0VsLmdldEVsZW1lbnRzQnlDbGFzc05hbWUoZGViaXRCYW5rTnVtYmVyQ2xhc3MpWzBdLmlubmVyVGV4dDtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFtb3VudCxcbiAgICAgICAgd2hlbkNoYXJnZSxcbiAgICAgICAgYmFua051bWJlcixcbiAgICAgIH07XG4gICAgfSk7XG4gIH0pO1xuICBjb25zdCBmdXR1cmVEZWJpdHMgPSByZXN1bHQubWFwKChpdGVtKSA9PiB7XG4gICAgY29uc3QgYW1vdW50RGF0YSA9IGdldEFtb3VudERhdGEoaXRlbS5hbW91bnQpO1xuICAgIGNvbnN0IGNoYXJnZURhdGUgPSAvXFxkezEsMn1bL11cXGR7Mn1bL11cXGR7Miw0fS8uZXhlYyhpdGVtLndoZW5DaGFyZ2UpPy5bMF07XG4gICAgY29uc3QgYmFua0FjY291bnROdW1iZXIgPSAvXFxkKy1cXGQrLy5leGVjKGl0ZW0uYmFua051bWJlcik/LlswXTtcbiAgICByZXR1cm4ge1xuICAgICAgYW1vdW50OiBhbW91bnREYXRhLmFtb3VudCxcbiAgICAgIGFtb3VudEN1cnJlbmN5OiBhbW91bnREYXRhLmN1cnJlbmN5LFxuICAgICAgY2hhcmdlRGF0ZSxcbiAgICAgIGJhbmtBY2NvdW50TnVtYmVyLFxuICAgIH07XG4gIH0pO1xuICByZXR1cm4gZnV0dXJlRGViaXRzO1xufVxuXG5jbGFzcyBWaXNhQ2FsU2NyYXBlciBleHRlbmRzIEJhc2VTY3JhcGVyV2l0aEJyb3dzZXIge1xuICBvcGVuTG9naW5Qb3B1cCA9IGFzeW5jICgpID0+IHtcbiAgICBkZWJ1Zygnb3BlbiBsb2dpbiBwb3B1cCwgd2FpdCB1bnRpbCBsb2dpbiBidXR0b24gYXZhaWxhYmxlJyk7XG4gICAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKHRoaXMucGFnZSwgJyNjY0xvZ2luRGVza3RvcEJ0bicsIHRydWUpO1xuICAgIGRlYnVnKCdjbGljayBvbiB0aGUgbG9naW4gYnV0dG9uJyk7XG4gICAgYXdhaXQgY2xpY2tCdXR0b24odGhpcy5wYWdlLCAnI2NjTG9naW5EZXNrdG9wQnRuJyk7XG4gICAgZGVidWcoJ2dldCB0aGUgZnJhbWUgdGhhdCBob2xkcyB0aGUgbG9naW4nKTtcbiAgICBjb25zdCBmcmFtZSA9IGF3YWl0IGdldExvZ2luRnJhbWUodGhpcy5wYWdlKTtcbiAgICBkZWJ1Zygnd2FpdCB1bnRpbCB0aGUgcGFzc3dvcmQgbG9naW4gdGFiIGhlYWRlciBpcyBhdmFpbGFibGUnKTtcbiAgICBhd2FpdCB3YWl0VW50aWxFbGVtZW50Rm91bmQoZnJhbWUsICcjcmVndWxhci1sb2dpbicpO1xuICAgIGRlYnVnKCduYXZpZ2F0ZSB0byB0aGUgcGFzc3dvcmQgbG9naW4gdGFiJyk7XG4gICAgYXdhaXQgY2xpY2tCdXR0b24oZnJhbWUsICcjcmVndWxhci1sb2dpbicpO1xuICAgIGRlYnVnKCd3YWl0IHVudGlsIHRoZSBwYXNzd29yZCBsb2dpbiB0YWIgaXMgYWN0aXZlJyk7XG4gICAgYXdhaXQgd2FpdFVudGlsRWxlbWVudEZvdW5kKGZyYW1lLCAncmVndWxhci1sb2dpbicpO1xuXG4gICAgcmV0dXJuIGZyYW1lO1xuICB9O1xuXG4gIGdldExvZ2luT3B0aW9ucyhjcmVkZW50aWFsczogUmVjb3JkPHN0cmluZywgc3RyaW5nPikge1xuICAgIHJldHVybiB7XG4gICAgICBsb2dpblVybDogYCR7TE9HSU5fVVJMfWAsXG4gICAgICBmaWVsZHM6IGNyZWF0ZUxvZ2luRmllbGRzKGNyZWRlbnRpYWxzKSxcbiAgICAgIHN1Ym1pdEJ1dHRvblNlbGVjdG9yOiAnYnV0dG9uW3R5cGU9XCJzdWJtaXRcIl0nLFxuICAgICAgcG9zc2libGVSZXN1bHRzOiBnZXRQb3NzaWJsZUxvZ2luUmVzdWx0cygpLFxuICAgICAgY2hlY2tSZWFkaW5lc3M6IGFzeW5jICgpID0+IHdhaXRVbnRpbEVsZW1lbnRGb3VuZCh0aGlzLnBhZ2UsICcjY2NMb2dpbkRlc2t0b3BCdG4nKSxcbiAgICAgIHByZUFjdGlvbjogdGhpcy5vcGVuTG9naW5Qb3B1cCxcbiAgICAgIHVzZXJBZ2VudDogJ01vemlsbGEvNS4wIChYMTE7IExpbnV4IHg4Nl82NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzc4LjAuMzkwNC4xMDggU2FmYXJpLzUzNy4zNicsXG4gICAgfTtcbiAgfVxuXG4gIGFzeW5jIGZldGNoRGF0YSgpOiBQcm9taXNlPFNjYXBlclNjcmFwaW5nUmVzdWx0PiB7XG4gICAgY29uc3QgZGVmYXVsdFN0YXJ0TW9tZW50ID0gbW9tZW50KCkuc3VidHJhY3QoMSwgJ3llYXJzJykuYWRkKDEsICdkYXknKTtcbiAgICBjb25zdCBzdGFydERhdGUgPSB0aGlzLm9wdGlvbnMuc3RhcnREYXRlIHx8IGRlZmF1bHRTdGFydE1vbWVudC50b0RhdGUoKTtcbiAgICBjb25zdCBzdGFydE1vbWVudCA9IG1vbWVudC5tYXgoZGVmYXVsdFN0YXJ0TW9tZW50LCBtb21lbnQoc3RhcnREYXRlKSk7XG4gICAgZGVidWcoYGZldGNoIHRyYW5zYWN0aW9ucyBzdGFydGluZyAke3N0YXJ0TW9tZW50LmZvcm1hdCgpfWApO1xuXG4gICAgZGVidWcoJ2ZldGNoIGZ1dHVyZSBkZWJpdHMnKTtcbiAgICBjb25zdCBmdXR1cmVEZWJpdHMgPSBhd2FpdCBmZXRjaEZ1dHVyZURlYml0cyh0aGlzLnBhZ2UpO1xuXG4gICAgZGVidWcoJ25hdmlnYXRlIHRvIHRyYW5zYWN0aW9ucyBwYWdlJyk7XG4gICAgYXdhaXQgdGhpcy5uYXZpZ2F0ZVRvKFRSQU5TQUNUSU9OU19VUkwsIHVuZGVmaW5lZCwgNjAwMDApO1xuXG4gICAgZGVidWcoJ2ZldGNoIGFjY291bnRzIHRyYW5zYWN0aW9ucycpO1xuICAgIGNvbnN0IGFjY291bnRzID0gYXdhaXQgZmV0Y2hUcmFuc2FjdGlvbnModGhpcy5wYWdlLCBzdGFydE1vbWVudCwgdGhpcy5vcHRpb25zKTtcblxuICAgIGRlYnVnKCdyZXR1cm4gdGhlIHNjcmFwZWQgYWNjb3VudHMnKTtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGFjY291bnRzLFxuICAgICAgZnV0dXJlRGViaXRzLFxuICAgIH07XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgVmlzYUNhbFNjcmFwZXI7XG4iXX0=