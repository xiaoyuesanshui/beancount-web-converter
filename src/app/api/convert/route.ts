import { NextRequest, NextResponse } from 'next/server';
import { parseFileContent, identifyBillType, parseTransactions, convertToBeancount, getBillMetadata } from '@/lib/converter';
import { parseConfig } from '@/lib/converter';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const configContent = formData.get('config') as string;

    if (!file) {
      console.log('错误：未上传文件');
      return NextResponse.json({ error: '请上传账单文件' }, { status: 400 });
    }

    if (!configContent) {
      console.log('错误：未提供配置文件');
      return NextResponse.json({ error: '请提供配置文件' }, { status: 400 });
    }

    // 解析配置
    const config = parseConfig(configContent);

    // 将 File 对象转换为 Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 解析文件内容
    const data = parseFileContent(buffer, file.name);

    console.log(`解析文件 ${file.name}，大小: ${file.size} bytes，解析结果行数: ${data.length}`);

    if (!data || data.length === 0) {
      console.log(`文件 ${file.name} 解析失败：返回空数组`);
      return NextResponse.json({
        error: '文件为空或格式不正确',
        debug: {
          fileName: file.name,
          fileSize: file.size,
          message: '未找到有效的数据行，请检查文件格式是否为CSV或Excel'
        }
      }, { status: 400 });
    }

    // 识别账单类型
    const billType = identifyBillType(data);

    // 获取账单元数据
    const { skipRows } = getBillMetadata(billType);

    // 检查数据结构，找到真正的数据开始行
    let actualSkipRows = 0;
    let dataStartRow = -1;

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (row && typeof row === 'object') {
        // 检查是否包含交易数据的关键字段
        const hasTradeFields = row['交易创建时间'] || row['交易时间'] || row['付款时间'];
        const hasAmount = row['金额'] || row['金额(元)'];

        if (hasTradeFields && hasAmount) {
          actualSkipRows = i;
          dataStartRow = i;
          break;
        }
      }
    }

    if (dataStartRow === -1) {
      return NextResponse.json({
        error: '未找到有效的交易记录',
        debug: {
          billType,
          totalRows: data.length,
          columns: data.length > 0 ? Object.keys(data[0]) : [],
        }
      }, { status: 400 });
    }

    // 解析交易记录
    const transactions = parseTransactions(data, billType, actualSkipRows);

    if (transactions.length === 0) {
      return NextResponse.json({
        error: '未找到有效的交易记录',
        debug: {
          billType,
          totalRows: data.length,
        }
      }, { status: 400 });
    }

    // 转换为Beancount格式
    const result = convertToBeancount(transactions, config, billType);

    return NextResponse.json(result);
  } catch (error) {
    console.error('转换失败:', error);
    return NextResponse.json(
      {
        error: (error as Error).message || '转换失败，请检查文件格式和配置',
      },
      { status: 500 }
    );
  }
}
