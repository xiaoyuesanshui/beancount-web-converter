const { convertToBeancount } = require('./src/lib/converter');
const { parseConfig } = require('./src/lib/converter');

const transactions = [
  {
    date: '2025-01-01',
    type: '支出',
    peer: '测试商户',
    item: '测试商品',
    amount: 100.00,
    method: '余额宝',
    status: '支付成功'
  }
];

const config = {
  defaultMinusAccount: 'Assets:Alipay',
  defaultPlusAccount: 'Expenses:Test',
  defaultCurrency: 'CNY',
  alipay: {
    rules: []
  }
};

const result = convertToBeancount(transactions, config, 'alipay');
console.log(result.beancountContent);
