import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import yaml from 'js-yaml';
import { BeancountConfig, Transaction, ConversionResult, BillType, Rule } from '@/types/config';
import { Buffer } from 'buffer';
import * as iconv from 'iconv-lite';

/**
 * 解析CSV或Excel文件内容（服务端版本）
 */
export function parseFileContent(buffer: Buffer, fileName: string): any[] {
  const extension = fileName.split('.').pop()?.toLowerCase();

  if (extension === 'csv') {
    // 尝试多种编码解析 CSV
    let csvString: string;

    // 检查BOM
    let startOffset = 0;
    if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      // UTF-8 BOM
      startOffset = 3;
    }

    // 先尝试UTF-8
    const utf8Buffer = startOffset > 0 ? buffer.slice(startOffset) : buffer;
    csvString = utf8Buffer.toString('utf-8');

    // 检查是否有大量替换字符（说明可能是GBK编码被误当UTF-8解析）
    const replacementCharCount = (csvString.match(/\ufffd/g) || []).length;
    const totalLength = csvString.length;
    const replacementRatio = replacementCharCount / totalLength;

    // 如果替换字符比例超过5%，尝试用GBK解码
    if (replacementRatio > 0.05 && buffer.length > 0) {
      try {
        const gbkString = iconv.decode(buffer, 'GBK');
        if (!gbkString.includes('\ufffd')) {
          csvString = gbkString;
        }
      } catch {
        // GBK解码失败，保持使用UTF-8
      }
    }

    // 解析 CSV，跳过空行
    const result = Papa.parse(csvString, {
      skipEmptyLines: true,
    });

    const rows = result.data as any[][];

    console.log('CSV 总行数:', rows.length);

    // 找到真正的数据开始行（包含"交易创建时间"、"交易时间"、"交易时间\t"等字段的行）
    let headerIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row && row.length > 0) {
        const rowStr = row.join(',');
        // 检查是否包含表头关键字
        if (rowStr.includes('交易创建时间') || rowStr.includes('交易时间') ||
            rowStr.includes('交易时间\t') || rowStr.includes('交易时间,交易')) {
          headerIndex = i;
          console.log(`找到表头行，索引: ${i}, 内容: ${JSON.stringify(row)}`);
          break;
        }
      }
    }

    // 检查是否找到表头
    if (headerIndex === -1) {
      console.log('未找到表头行，返回空数组');
      return [];
    }

    // 解析表头
    const headerRow = rows[headerIndex];
    let headers: string[] = [];

    console.log('表头行长度:', headerRow.length);

    // 检查是否有以换行符开头的数据（说明表头和数据混在一起）
    const firstDataIndex = headerRow.findIndex((cell: any) => typeof cell === 'string' && cell.startsWith('\n'));

    if (firstDataIndex !== -1) {
      console.log('检测到表头和数据混在一起的情况，数据开始于索引:', firstDataIndex);

      // 提取表头（第一个 \n 之前的所有元素）
      headers = headerRow.slice(0, firstDataIndex);

      // 提取数据行
      const dataRows: any[][] = [];
      let currentRow: any[] = [];

      for (let i = firstDataIndex; i < headerRow.length; i++) {
        const cell = headerRow[i];
        if (typeof cell === 'string' && cell.startsWith('\n')) {
          // 新数据行的开始
          if (currentRow.length > 0) {
            dataRows.push(currentRow);
          }
          // 移除开头的 \n
          currentRow = [cell.substring(1)];
        } else {
          // 数据行的后续字段
          currentRow.push(cell);
        }
      }

      // 添加最后一行
      if (currentRow.length > 0) {
        dataRows.push(currentRow);
      }

      // 转换为对象数组
      const objects = dataRows.map(row => {
        const obj: any = {};
        headers.forEach((header, index) => {
          let value = row[index] || '';
          // 移除末尾的制表符和空格
          if (typeof value === 'string') {
            value = value.replace(/\t+$/, '').trim();
          }
          obj[header] = safeString(value);
        });
        return obj;
      });

      return objects.filter(obj => {
        // 过滤掉空行和无效行
        return Object.keys(obj).some(key => obj[key] && obj[key].trim() !== '');
      });
    }

    // 正常情况：表头和数据行分开
    headers = headerRow;

    const dataRows = rows.slice(headerIndex + 1);

    console.log('数据行数:', dataRows.length);

    // 将数据行转换为对象数组
    const objects = dataRows.map(row => {
      const obj: any = {};
      headers.forEach((header, index) => {
        obj[header] = row[index] || '';
      });
      return obj;
    });

    const filteredObjects = objects.filter(obj => {
      // 过滤掉空行和无效行
      return Object.keys(obj).some(key => obj[key] && obj[key].trim() !== '');
    });

    console.log('过滤后的对象数:', filteredObjects.length);
    return filteredObjects;
  } else if (extension === 'xlsx' || extension === 'xls') {
    // 使用 xlsx 解析 Excel
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(worksheet) as Record<string, any>[];

    // 检查是否是微信账单格式（第一行只有一个字段"微信支付账单明细"）
    if (rawData.length > 0 && '微信支付账单明细' in rawData[0]) {
      // 微信账单格式，需要特殊处理
      return parseWeChatExcel(rawData);
    }

    return rawData;
  } else {
    throw new Error('不支持的文件格式，仅支持 CSV、XLSX、XLS');
  }
}

/**
 * 识别账单类型
 */
export function identifyBillType(data: any[]): BillType {
  if (data.length === 0) return 'alipay';

  const columns = Object.keys(data[0]);

  if (columns.includes('收/支') && columns.includes('交易对方') && columns.includes('商品说明')) {
    return 'alipay';
  } else if (columns.includes('收/支') && columns.includes('交易类型') && columns.includes('交易对方')) {
    return 'wechat';
  }

  return 'alipay';
}

/**
 * 解析交易记录
 */
export function parseTransactions(data: any[], billType: BillType, skipRows: number = 0): Transaction[] {
  const transactions: Transaction[] = [];

  // 跳过前N行（说明信息）
  const startIndex = skipRows;

  for (let i = startIndex; i < data.length; i++) {
    const row = data[i];

    if (!row || Object.keys(row).length === 0) continue;

    try {
      let transaction: Transaction;

      if (billType === 'alipay') {
        // 支付宝格式
        const dateStr = safeString(row['交易创建时间'] || row['交易时间'] || row['日期'] || '');
        const type = safeString(row['收/支'] || '');
        const peer = safeString(row['交易对方'] || '');
        const item = safeString(row['商品说明'] || row['商品'] || '');
        const amountStr = safeString(row['金额'] || '0');
        const method = safeString(row['收/付款方式'] || row['支付方式'] || '');
        const status = safeString(row['业务状态'] || row['交易状态'] || '');
        const category = safeString(row['交易分类'] || '');

        // 过滤无效记录：关闭的交易跳过，但保留退款成功和还款成功的交易
        if (!dateStr || status.includes('关闭')) continue;

        // 特殊处理退款交易：如果"不计收支"但状态是"退款成功"，则计入收入
        // 特殊处理还款交易：如果交易分类是"信用借还"+"不计收支"+"还款成功"，则计入支出
        let finalType = type;
        if (type === '不计收支' && status.includes('退款成功')) {
          finalType = '收入';
        } else if (category === '信用借还' && type === '不计收支' && status.includes('还款成功')) {
          finalType = '支出';
        }

        transaction = {
          date: formatDate(dateStr),
          type: finalType,
          peer,
          item,
          amount: parseAmount(amountStr),
          method,
          status,
        };
      } else {
        // 微信格式
        const dateStr = safeString(row['交易时间'] || row['交易时间  '] || '');
        const type = safeString(row['收/支'] || '');
        const peer = safeString(row['交易对方'] || '');
        const item = safeString(row['商品'] || row['商品说明'] || '');
        const amountStr = safeString(row['金额(元)'] || row['金额'] || '0');
        const method = safeString(row['支付方式'] || '');
        const status = safeString(row['当前状态'] || row['交易状态'] || '');
        const txType = safeString(row['交易类型'] || '');

        // 过滤无效记录
        if (!dateStr || status.includes('关闭')) continue;

        transaction = {
          date: formatDate(dateStr),
          type,
          peer,
          item,
          amount: parseAmount(amountStr),
          method,
          txType,
          status,
        };
      }

      transactions.push(transaction);
    } catch (error) {
      console.warn(`解析第 ${i + 1} 行失败:`, error);
    }
  }

  return transactions;
}

/**
 * 转换为Beancount格式
 */
export function convertToBeancount(
  transactions: Transaction[],
  config: BeancountConfig,
  billType: BillType
): ConversionResult {
  const {
    defaultMinusAccount,
    defaultPlusAccount,
    defaultCurrency = 'CNY',
  } = config;

  // 提取规则
  const rules = billType === 'alipay' ? (config.alipay?.rules || []) : (config.wechat?.rules || []);

  // 构建匹配字典（按照原项目逻辑）
  const peerRules: Record<string, string> = {};
  const methodRules: Record<string, string> = {};
  const txTypeRules: Record<string, string> = {};

  rules.forEach(rule => {
    if (rule.peer && rule.targetAccount) {
      peerRules[rule.peer] = rule.targetAccount;
    }
    if (rule.method && rule.methodAccount) {
      methodRules[rule.method] = rule.methodAccount;
    }
    if (rule.txType && rule.targetAccount) {
      txTypeRules[rule.txType] = rule.targetAccount;
    }
  });

  const beancountEntries: string[] = [];
  let skippedCount = 0;

  for (const tx of transactions) {
    try {
      // 解析日期
      const dateMatch = tx.date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!dateMatch) {
        skippedCount++;
        continue;
      }
      const dateStr = tx.date;

      // 确定减方账户（通常是付款账户）
      let minusAccount = defaultMinusAccount;

      // 根据对手方匹配规则确定加方账户
      let plusAccount = defaultPlusAccount;

      // 尝试匹配对手方
      if (tx.peer) {
        for (const [peerPattern, account] of Object.entries(peerRules)) {
          if (peerPattern !== '/' && tx.peer.includes(peerPattern)) {
            plusAccount = account;
            break;
          }
        }
      }

      // 对于支付宝账单，匹配methodAccount
      if (billType === 'alipay') {
        // 特殊处理退款交易：使用原支付方式作为减方账户
        const isRefund = tx.status && tx.status.includes('退款成功');
        
        if (isRefund && tx.method) {
          // 退款交易：根据支付方式匹配减方账户
          let methodAccountMatched = false;
          for (const rule of rules) {
            if (rule.methodAccount && rule.method && rule.method !== '/') {
              let methodMatch = false;
              if (rule.fullMatch === true) {
                methodMatch = tx.method === rule.method;
              } else {
                methodMatch = tx.method.includes(rule.method);
              }
              if (methodMatch) {
                minusAccount = rule.methodAccount;
                methodAccountMatched = true;
                break;
              }
            }
          }
          // 如果没有匹配到，尝试使用支付方式字典匹配
          if (!methodAccountMatched) {
            for (const [methodPattern, account] of Object.entries(methodRules)) {
              if (methodPattern !== '/' && tx.method.includes(methodPattern)) {
                minusAccount = account;
                break;
              }
            }
          }
          // 退款交易的加方账户默认为退款收入账户
          plusAccount = 'Income:Refund';
        } else {
          // 普通交易：按照规则匹配
          // 按照配置文件中的规则顺序进行匹配
          let ruleMatched = false;

          for (const rule of rules) {
            if (rule.methodAccount) {
              // 检查 peer 匹配
              let peerMatch = true;
              if (rule.peer && rule.peer !== '/') {
                if (!tx.peer) {
                  peerMatch = false;
                } else {
                  // 支持 fullMatch：如果设置为 true，则完全匹配；否则使用包含匹配
                  if (rule.fullMatch === true) {
                    peerMatch = tx.peer === rule.peer;
                  } else {
                    peerMatch = tx.peer.includes(rule.peer);
                  }
                }
              }

              // 检查其他匹配条件
              let conditionMatch = true;
              
              // 如果规则指定了type，且不是'/'，则必须匹配
              if (rule.type && rule.type !== '/' && rule.type !== tx.type) {
                conditionMatch = false;
              }
              
              // 如果规则指定了method，且不是'/'，则必须匹配
              if (conditionMatch && rule.method && rule.method !== '/') {
                if (!tx.method) {
                  conditionMatch = false;
                } else {
                  // 支持 fullMatch：如果设置为 true，则完全匹配；否则使用包含匹配
                  if (rule.fullMatch === true) {
                    conditionMatch = tx.method === rule.method;
                  } else {
                    conditionMatch = tx.method.includes(rule.method);
                  }
                }
              }
              
              // 如果规则指定了item，且不是'/'，则必须匹配
              if (conditionMatch && rule.item && rule.item !== '/' && !tx.item.includes(rule.item)) {
                conditionMatch = false;
              }

              if (peerMatch && conditionMatch) {
                minusAccount = rule.methodAccount;
                // 如果规则指定了targetAccount，则使用规则中的账户
                if (rule.targetAccount) {
                  plusAccount = rule.targetAccount;
                }
                ruleMatched = true;
                break;
              }
            }
          }

          // 如果没有通过规则匹配，尝试匹配支付方式（用于确定减方账户）
          if (!ruleMatched && tx.method) {
            for (const [methodPattern, account] of Object.entries(methodRules)) {
              if (methodPattern !== '/' && tx.method.includes(methodPattern)) {
                minusAccount = account;
                break;
              }
            }
          }
        }
      }

      // 对于微信账单，还需要匹配交易类型和收付款方式
      if (billType === 'wechat') {
        // 按照配置文件中的规则顺序进行匹配，以支持更精细的匹配
        let ruleMatched = false; // 标记是否通过规则匹配

        for (const rule of rules) {
          if (rule.methodAccount) {
            // 检查 peer 匹配
            let peerMatch = true;
            if (rule.peer && rule.peer !== '/') {
              if (!tx.peer) {
                peerMatch = false;
              } else {
                // 支持 fullMatch：如果设置为 true，则完全匹配；否则使用包含匹配
                if (rule.fullMatch === true) {
                  peerMatch = tx.peer === rule.peer;
                } else {
                  peerMatch = tx.peer.includes(rule.peer);
                }
              }
            }

            // 检查其他匹配条件
            let conditionMatch = true;
            // 如果规则指定了type，且不是'/'，则必须匹配
            if (rule.type && rule.type !== '/' && rule.type !== tx.type) {
              conditionMatch = false;
            }
            // 如果规则指定了txType，且不是'/'，则必须匹配
            if (conditionMatch && rule.txType && rule.txType !== '/' && tx.txType && !tx.txType.includes(rule.txType)) {
              conditionMatch = false;
            }
            // 如果规则指定了method，且不是'/'，则必须匹配
            if (conditionMatch && rule.method && rule.method !== '/') {
              if (!tx.method) {
                conditionMatch = false;
              } else {
                // 支持 fullMatch：如果设置为 true，则完全匹配；否则使用包含匹配
                if (rule.fullMatch === true) {
                  conditionMatch = tx.method === rule.method;
                } else {
                  conditionMatch = tx.method.includes(rule.method);
                }
              }
            }
            // 如果规则指定了item，且不是'/'，则必须匹配
            if (conditionMatch && rule.item && rule.item !== '/' && !tx.item.includes(rule.item)) {
              conditionMatch = false;
            }

            if (peerMatch && conditionMatch) {
              minusAccount = rule.methodAccount;
              // 如果规则指定了targetAccount，则使用规则中的账户
              if (rule.targetAccount) {
                plusAccount = rule.targetAccount;
              }
              ruleMatched = true;
              break;
            }
          }
        }

        // 匹配收付款方式（用于确定减方账户）- 只在未通过规则匹配时使用
        if (!ruleMatched && tx.method) {
          for (const [methodPattern, account] of Object.entries(methodRules)) {
            if (methodPattern !== '/' && tx.method.includes(methodPattern)) {
              minusAccount = account;
              break;
            }
          }
        }
      }

      // 确定金额符号
      const amount = tx.amount;
      let plusAmountStr: string;
      let minusAmountStr: string;

      if (tx.type === '支出') {
        // 支出：加方账户为正，减方账户为负
        plusAmountStr = `${amount.toFixed(2)} ${defaultCurrency}`;
        minusAmountStr = `-${amount.toFixed(2)} ${defaultCurrency}`;
      } else if (tx.type === '收入') {
        // 收入：加方账户为负，减方账户为正
        plusAmountStr = `-${amount.toFixed(2)} ${defaultCurrency}`;
        minusAmountStr = `${amount.toFixed(2)} ${defaultCurrency}`;
      } else {
        // 不计收支（如退款）：按收入处理，钱回到账户
        plusAmountStr = `-${amount.toFixed(2)} ${defaultCurrency}`;
        minusAmountStr = `${amount.toFixed(2)} ${defaultCurrency}`;
      }

      // 生成beancount条目（注意：末尾不要换行符，因为后面会用join连接）
      // beancount标准格式：账户名后加空格，然后金额
      const metadataLines: string[] = [];
      if (billType === 'alipay') {
        // 支付宝账单元数据（简化版，只保留关键字段）
        metadataLines.push(`\tmethod: "${tx.method}"`);
        metadataLines.push(`\ttype: "${tx.type}"`);
        metadataLines.push(`\tsource: "支付宝"`);
      } else {
        // wechat
        // 微信账单元数据（简化版，只保留关键字段）
        metadataLines.push(`\tmethod: "${tx.method}"`);
        metadataLines.push(`\ttype: "${tx.type}"`);
        metadataLines.push(`\tsource: "微信支付"`);
      }

      const metadataStr = metadataLines.length > 0 ? metadataLines.join('\n') : '';

      let beancountEntry: string;
      if (metadataStr) {
        beancountEntry = `${dateStr} * "${tx.peer}" "${tx.item}"\n${metadataStr}\n    ${plusAccount}      ${plusAmountStr}\n    ${minusAccount}      ${minusAmountStr}`;
      } else {
        beancountEntry = `${dateStr} * "${tx.peer}" "${tx.item}"\n    ${plusAccount}      ${plusAmountStr}\n    ${minusAccount}      ${minusAmountStr}`;
      }

      beancountEntries.push(beancountEntry);
    } catch (error) {
      console.warn('生成条目失败:', tx, error);
      skippedCount++;
    }
  }

  skippedCount = transactions.length - beancountEntries.length;

  // 生成完整的Beancount内容
  const billTypeStr = billType === 'alipay' ? '支付宝' : '微信';
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const summary = [
    '; 转换摘要',
    `; 账单类型：${billTypeStr}`,
    `; 成功转换记录数：${beancountEntries.length} 条`,
    `; 跳过记录数：${skippedCount} 条`,
    `; 生成时间：${timestamp}`,
    '',
    ...beancountEntries,
  ].join('\n\n');

  return {
    success: true,
    summary: {
      billType: billTypeStr,
      successCount: beancountEntries.length,
      skippedCount,
      timestamp,
      configPath: '',
    },
    beancountContent: summary,
    transactions,
  };
}

/**
 * 解析YAML配置
 */
export function parseConfig(yamlContent: string): BeancountConfig {
  try {
    return yaml.load(yamlContent) as BeancountConfig;
  } catch (error) {
    throw new Error('配置文件解析失败: ' + (error as Error).message);
  }
}

/**
 * 获取账单的跳过行数和编码
 */
export function getBillMetadata(billType: BillType) {
  if (billType === 'alipay') {
    return {
      skipRows: 24,
      encoding: 'GB2312',
    };
  } else {
    return {
      skipRows: 16,
      encoding: 'UTF-8',
    };
  }
}

// 辅助函数
function safeString(value: any): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * 解析微信账单 Excel 格式
 */
function parseWeChatExcel(rawData: any[]): any[] {
  // 微信账单格式：
  // 前14行是说明信息
  // 第13行是分隔线"----------------------微信支付账单明细列表--------------------"
  // 第14行（索引14）是表头，字段名很特殊（__EMPTY, __EMPTY_1等）
  // 从第15行开始（索引15）是数据

  if (rawData.length <= 15) {
    return [];
  }

  // 表头行（第15行，索引14）
  const headerRow = rawData[14];

  // 微信账单的列顺序
  // 0: 交易时间
  // 1: 交易类型 (__EMPTY)
  // 2: 交易对方 (__EMPTY_1)
  // 3: 商品 (__EMPTY_2)
  // 4: 收/支 (__EMPTY_3)
  // 5: 金额(元) (__EMPTY_4)
  // 6: 支付方式 (__EMPTY_5)
  // 7: 当前状态 (__EMPTY_6)
  // 8: 交易单号 (__EMPTY_7)
  // 9: 商户单号 (__EMPTY_8)
  // 10: 备注 (__EMPTY_9)

  // 提取数据行（从第16行开始，索引15）
  const dataRows = rawData.slice(15);

  // 转换为标准格式
  const result = dataRows.map(row => {
    // 处理交易时间：可能是Excel日期序列号或字符串
    let txTime = row['微信支付账单明细'];
    if (typeof txTime === 'number') {
      // Excel日期序列号转换为日期字符串
      const date = XLSX.SSF.parse_date_code(txTime);
      if (date) {
        txTime = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')} ${String(date.H).padStart(2, '0')}:${String(date.M).padStart(2, '0')}:${String(date.S).padStart(2, '0')}`;
      }
    }

    return {
      '交易时间': safeString(txTime),
      '交易类型': safeString(row['__EMPTY']),
      '交易对方': safeString(row['__EMPTY_1']),
      '商品': safeString(row['__EMPTY_2']),
      '收/支': safeString(row['__EMPTY_3']),
      '金额(元)': safeString(row['__EMPTY_4']),
      '支付方式': safeString(row['__EMPTY_5']),
      '当前状态': safeString(row['__EMPTY_6']),
      '交易单号': safeString(row['__EMPTY_7']),
      '商户单号': safeString(row['__EMPTY_8']),
      '备注': safeString(row['__EMPTY_9']),
    };
  });

  // 过滤掉空行和无效行
  return result.filter(obj => {
    const txTime = obj['交易时间'];
    // 检查是否有有效的交易时间（格式：YYYY-MM-DD HH:MM:SS 或 YYYY/MM/DD HH:MM:SS）
    const hasValidData = txTime && (
      /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(txTime) ||
      /^\d{4}-\d{1,2}-\d{1,2} \d{2}:\d{2}:\d{2}/.test(txTime)
    );
    return hasValidData;
  });
}

function formatDate(dateStr: string): string {
  // 支持多种日期格式
  dateStr = dateStr.trim();

  // 2025-01-11 12:34:56 -> 2025-01-11
  if (dateStr.includes(' ')) {
    dateStr = dateStr.split(' ')[0];
  }

  // 2025/01/11 -> 2025-01-11
  if (dateStr.includes('/')) {
    dateStr = dateStr.replace(/\//g, '-');
  }

  return dateStr;
}

function parseAmount(amountStr: string): number {
  // 移除逗号、空格和人民币符号
  amountStr = amountStr.replace(/,/g, '').replace(/\s/g, '').replace(/[¥￥]/g, '').trim();

  const amount = parseFloat(amountStr);

  if (isNaN(amount)) {
    return 0;
  }

  return amount;
}
