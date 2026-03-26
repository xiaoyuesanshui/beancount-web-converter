// 配置文件类型定义

export interface BeancountConfig {
  defaultMinusAccount: string;
  defaultPlusAccount: string;
  defaultCurrency: string;
  title?: string;
  alipay?: {
    rules: Rule[];
  };
  wechat?: {
    rules: Rule[];
  };
}

export interface Rule {
  peer?: string;
  type?: string;
  item?: string;
  method?: string;
  txType?: string;
  targetAccount?: string;
  methodAccount?: string;
  fullMatch?: boolean;
  pnlAccount?: string;
}

// 账单交易记录
export interface Transaction {
  date: string;
  type: string; // 收/支
  peer: string; // 交易对方
  item: string; // 商品说明
  amount: number; // 金额
  method: string; // 支付方式
  txType?: string; // 交易类型（微信）
  status: string; // 交易状态
}

// 转换结果
export interface ConversionResult {
  success: boolean;
  summary: {
    billType: string;
    successCount: number;
    skippedCount: number;
    timestamp: string;
    configPath: string;
  };
  beancountContent: string;
  transactions: Transaction[];
}

// 账单类型
export type BillType = 'alipay' | 'wechat';
