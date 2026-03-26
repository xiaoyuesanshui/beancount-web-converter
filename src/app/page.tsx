'use client';

import { useState, useEffect, useRef } from 'react';
import { Upload, FileText, Download, AlertCircle, CheckCircle, Loader2, Plus, Edit2, Trash2, Settings, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import yaml from 'js-yaml';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [billType, setBillType] = useState<'alipay' | 'wechat' | null>(null);
  const [alipayConfig, setAlipayConfig] = useState('');
  const [wechatConfig, setWechatConfig] = useState('');
  const [configLoading, setConfigLoading] = useState(true);
  
  const [config, setConfig] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fileInfo, setFileInfo] = useState<{ name: string; size: number; type: string } | null>(null);
  
  // 可视化配置编辑器状态
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [parsedConfig, setParsedConfig] = useState<any>(null);
  const [showRuleEditor, setShowRuleEditor] = useState(false);
  const [editingRule, setEditingRule] = useState<any>(null);
  const [ruleType, setRuleType] = useState<'peer' | 'method'>('peer');
  
  // 用于跟踪是否正在初始化加载
  const isInitializing = useRef(true);
  
  // 浮动面板状态 - 配置文件区域拖动
  const [configPanelFloating, setConfigPanelFloating] = useState({
    isFloating: false,
    x: 0,
    y: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
  });

  // 解析配置并更新可视化编辑器
  useEffect(() => {
    if (config) {
      try {
        const parsed = yaml.load(config) as any;
        setParsedConfig(parsed);
      } catch (err) {
        console.error('解析配置失败:', err);
      }
    }
  }, [config]);

  // 加载配置文件
  useEffect(() => {
    const loadConfigs = async () => {
      try {
        // 先尝试从localStorage加载配置
        let aliText = '';
        let wechatText = '';

        if (typeof window !== 'undefined') {
          const savedAliConfig = localStorage.getItem('beancount-config-alipay');
          const savedWechatConfig = localStorage.getItem('beancount-config-wechat');

          if (savedAliConfig) {
            aliText = savedAliConfig;
          }
          if (savedWechatConfig) {
            wechatText = savedWechatConfig;
          }
        }

        // 如果localStorage中没有配置，从public目录加载
        if (!aliText || !wechatText) {
          const [aliRes, wechatRes] = await Promise.all([
            fetch('/config-ali.yaml'),
            fetch('/config-wechat.yaml')
          ]);

          if (!aliText) aliText = await aliRes.text();
          if (!wechatText) wechatText = await wechatRes.text();
        }

        setAlipayConfig(aliText);
        setWechatConfig(wechatText);
        setConfig(aliText); // 默认使用支付宝配置
        setConfigLoading(false);
        
        // 初始化完成
        setTimeout(() => {
          isInitializing.current = false;
        }, 100);
      } catch (err) {
        console.error('加载配置文件失败:', err);
        setError('加载配置文件失败，请刷新页面重试');
        setConfigLoading(false);
        setTimeout(() => {
          isInitializing.current = false;
        }, 100);
      }
    };

    loadConfigs();
  }, []);

  // 自动保存配置到localStorage
  useEffect(() => {
    // 如果正在初始化或没有账单类型，不保存
    if (isInitializing.current || !billType || !config) {
      return;
    }

    // 保存当前配置到localStorage
    saveConfigToLocalStorage(billType, config);
  }, [config, billType]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // 验证文件大小
      if (selectedFile.size === 0) {
        setError('文件为空，请重新选择文件');
        setFile(null);
        setFileInfo(null);
        return;
      }

      // 验证文件格式
      const validExtensions = ['.csv', '.xlsx', '.xls'];
      const fileExtension = selectedFile.name.toLowerCase().substring(
        selectedFile.name.lastIndexOf('.')
      );

      if (!validExtensions.includes(fileExtension)) {
        setError('不支持的文件格式，请上传 .csv、.xlsx 或 .xls 文件');
        setFile(null);
        setFileInfo(null);
        return;
      }

      // 识别账单类型
      let detectedType: 'alipay' | 'wechat' | null = null;
      const fileName = selectedFile.name.toLowerCase();

      if (fileName.includes('微信') || fileName.includes('wechat')) {
        detectedType = 'wechat';
      } else if (fileName.includes('支付宝') || fileName.includes('alipay')) {
        detectedType = 'alipay';
      } else {
        // 如果文件名不明确，默认根据配置切换
        // 用户可以手动修改
        detectedType = null;
      }

      setBillType(detectedType);

      // 根据检测到的类型自动切换配置
      if (detectedType === 'wechat') {
        setConfig(wechatConfig);
      } else if (detectedType === 'alipay') {
        setConfig(alipayConfig);
      } else {
        // 无法确定类型，保持当前配置
      }

      setFile(selectedFile);
      setFileInfo({
        name: selectedFile.name,
        size: selectedFile.size,
        type: selectedFile.type || 'unknown'
      });
      setError('');
      setResult(null);
    }
  };

  const handleConvert = async () => {
    if (!file) {
      setError('请先上传账单文件');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('config', config);

      const response = await fetch('/api/convert', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '转换失败');
      }

      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;

    const blob = new Blob([result.beancountContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `beancount_${new Date().getTime()}.bean`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 规则编辑器函数
  const handleAddRule = (type: 'peer' | 'method') => {
    setRuleType(type);
    setEditingRule({
      peer: type === 'peer' ? '' : '/',
      method: type === 'method' ? '' : '/',
      targetAccount: '',
      methodAccount: '',
      type: '/',
      item: '/',
      txType: '/',
    });
    setShowRuleEditor(true);
  };

  const handleEditRule = (type: 'peer' | 'method', index: number) => {
    setRuleType(type);
    const rules = billType === 'alipay' ? parsedConfig?.alipay?.rules || [] : parsedConfig?.wechat?.rules || [];
    const rule = rules[index];
    setEditingRule({ ...rule });
    setShowRuleEditor(true);
  };

  const handleDeleteRule = (type: 'peer' | 'method', index: number) => {
    if (!parsedConfig || !billType) return;
    
    const key = billType as 'alipay' | 'wechat';
    const newRules = [...(parsedConfig[key]?.rules || [])];
    newRules.splice(index, 1);
    
    const newConfig = {
      ...parsedConfig,
      [key]: {
        ...parsedConfig[key],
        rules: newRules
      }
    };
    
    const newYaml = yaml.dump(newConfig);
    setConfig(newYaml);
    setParsedConfig(newConfig);
    
    // 保存到localStorage
    saveConfigToLocalStorage(key, newYaml);
  };

  const handleSaveRule = () => {
    if (!parsedConfig || !billType || !editingRule) return;
    
    const key = billType as 'alipay' | 'wechat';
    const rules = parsedConfig[key]?.rules || [];
    
    // 清理规则对象，移除空值和默认值
    const cleanedRule = cleanRule(editingRule);
    
    // 根据ruleType找到对应的索引
    const filteredRules = rules.filter((r: any) => {
      if (ruleType === 'peer') {
        return r.peer && r.peer !== '/';
      } else {
        return r.method && r.method !== '/';
      }
    });
    
    // 查找是否是编辑现有规则
    const existingIndex = rules.findIndex((r: any) => {
      if (ruleType === 'peer') {
        return r.peer === editingRule.peer && editingRule.peer !== '/';
      } else {
        return r.method === editingRule.method && editingRule.method !== '/';
      }
    });
    
    let newRules;
    if (existingIndex !== -1) {
      // 更新现有规则
      newRules = [...rules];
      newRules[existingIndex] = cleanedRule;
    } else {
      // 添加新规则到相应类型的末尾
      newRules = [...rules];
      if (ruleType === 'peer') {
        // 找到最后一个peer规则的位置
        const lastPeerIndex = rules.findLastIndex((r: any) => r.peer && r.peer !== '/');
        newRules.splice(lastPeerIndex + 1, 0, cleanedRule);
      } else {
        // 添加到末尾
        newRules.push(cleanedRule);
      }
    }
    
    // 清理所有规则中的空值字段
    const cleanedRules = newRules.map(cleanRule);
    
    const newConfig = {
      ...parsedConfig,
      [key]: {
        ...parsedConfig[key],
        rules: cleanedRules
      }
    };
    
    const newYaml = yaml.dump(newConfig);
    setConfig(newYaml);
    setParsedConfig(newConfig);
    
    // 保存到localStorage
    saveConfigToLocalStorage(key, newYaml);
    
    setShowRuleEditor(false);
    setEditingRule(null);
  };

  const handleCancelRuleEdit = () => {
    setShowRuleEditor(false);
    setEditingRule(null);
  };

  // 清理规则对象，移除空值和默认值
  const cleanRule = (rule: any) => {
    const cleaned: any = {};
    for (const [key, value] of Object.entries(rule)) {
      // 跳过空值、null、undefined、"/"等无效值
      if (value !== null && value !== undefined && value !== '' && value !== '/') {
        cleaned[key] = value;
      }
    }
    return cleaned;
  };

  // 保存配置到localStorage
  const saveConfigToLocalStorage = (billType: 'alipay' | 'wechat', configStr: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`beancount-config-${billType}`, configStr);
    }
  };

  // 从localStorage加载配置
  const loadConfigFromLocalStorage = (billType: 'alipay' | 'wechat'): string | null => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(`beancount-config-${billType}`);
    }
    return null;
  };

  // 切换账单类型，自动保存当前配置
  const handleSwitchBillType = (type: 'alipay' | 'wechat') => {
    // 保存当前配置到localStorage（如果有修改）
    if (billType && config) {
      saveConfigToLocalStorage(billType, config);
    }

    // 切换到新类型
    setBillType(type);
    
    // 从localStorage或初始配置中加载目标类型的配置
    const savedConfig = loadConfigFromLocalStorage(type);
    const defaultConfig = type === 'alipay' ? alipayConfig : wechatConfig;
    setConfig(savedConfig || defaultConfig);
  };

  // 配置面板拖动处理
  const handleConfigPanelMouseDown = (e: React.MouseEvent) => {
    if (!configPanelFloating.isFloating) return;
    e.preventDefault();
    setConfigPanelFloating({
      ...configPanelFloating,
      isDragging: true,
      dragStartX: e.clientX - configPanelFloating.x,
      dragStartY: e.clientY - configPanelFloating.y,
    });
  };

  const handleConfigPanelMouseMove = (e: MouseEvent) => {
    if (configPanelFloating.isDragging) {
      setConfigPanelFloating({
        ...configPanelFloating,
        x: e.clientX - configPanelFloating.dragStartX,
        y: e.clientY - configPanelFloating.dragStartY,
      });
    }
  };

  const handleConfigPanelMouseUp = () => {
    if (configPanelFloating.isDragging) {
      setConfigPanelFloating({
        ...configPanelFloating,
        isDragging: false,
      });
    }
  };

  // 监听鼠标移动和松开事件
  useEffect(() => {
    if (configPanelFloating.isDragging) {
      window.addEventListener('mousemove', handleConfigPanelMouseMove);
      window.addEventListener('mouseup', handleConfigPanelMouseUp);
    }
    
    return () => {
      window.removeEventListener('mousemove', handleConfigPanelMouseMove);
      window.removeEventListener('mouseup', handleConfigPanelMouseUp);
    };
  }, [configPanelFloating.isDragging, configPanelFloating.dragStartX, configPanelFloating.dragStartY]);

  // 获取分类后的规则
  const getRulesByType = () => {
    if (!parsedConfig || !billType) return { peerRules: [], methodRules: [] };
    
    const key = billType as 'alipay' | 'wechat';
    const rules = parsedConfig[key]?.rules || [];
    
    const peerRules = rules.filter((r: any) => r.peer && r.peer !== '/');
    const methodRules = rules.filter((r: any) => r.method && r.method !== '/');
    
    return { peerRules, methodRules };
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50 mb-1">
            Beancount 账单转换器
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            将支付宝/微信账单转换为 Beancount 复式记账格式
          </p>
        </div>

        {/* Instructions - Moved to top */}
        <div className="mb-6 bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4 border border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-2">
            <FileText className="w-5 h-5 text-slate-500 dark:text-slate-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50 mb-2">使用说明</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-600 dark:text-slate-400">
                <div>
                  <p className="font-medium mb-1">1. 导出账单</p>
                  <p>从支付宝/微信导出 CSV 或 Excel 格式的账单文件</p>
                </div>
                <div>
                  <p className="font-medium mb-1">2. 上传文件</p>
                  <p>上传账单文件，系统会自动识别账单类型并加载对应配置</p>
                </div>
                <div>
                  <p className="font-medium mb-1">3. 转换下载</p>
                  <p>点击转换按钮，预览结果并下载 Beancount 格式文件</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6 items-stretch">
          {/* Left Column: Upload and Config */}
          <div className="col-span-12 lg:col-span-4 space-y-6">
            {/* File Upload Section - Compact */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4 border border-slate-200 dark:border-slate-800 flex-shrink-0">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50 mb-3 flex items-center gap-2">
                <Upload className="w-4 h-4" />
                上传账单
              </h2>

              <div className="flex items-center gap-3">
                <input
                  type="file"
                  id="file-upload"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <label
                  htmlFor="file-upload"
                  className="flex-1 min-w-0 cursor-pointer"
                >
                  <div
                    className={`border-2 border-dashed rounded-lg p-3 text-center transition-colors ${
                      file
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20'
                        : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                    }`}
                  >
                    {file ? (
                      <div className="flex items-center justify-center gap-2 overflow-hidden">
                        <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                        <p className="text-sm text-slate-900 dark:text-slate-50 font-medium truncate w-full">
                          {file.name}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        点击选择文件
                      </p>
                    )}
                  </div>
                </label>

                <Button
                  onClick={handleConvert}
                  disabled={loading || !file}
                  size="default"
                  className="flex-shrink-0 whitespace-nowrap"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    '开始转换'
                  )}
                </Button>
              </div>

              {billType && (
                <div className="mt-2 text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1">
                  <span>检测到：</span>
                  <span className="font-medium text-blue-600 dark:text-blue-400">
                    {billType === 'alipay' ? '支付宝账单' : '微信账单'}
                  </span>
                </div>
              )}
            </div>

            {/* Config Section */}
            <div 
              className={`bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4 border border-slate-200 dark:border-slate-800 ${configPanelFloating.isFloating ? 'fixed z-50 shadow-2xl' : ''}`}
              style={configPanelFloating.isFloating ? {
                left: configPanelFloating.x,
                top: configPanelFloating.y,
                width: '380px',
                maxHeight: '80vh',
              } : {}}
            >
              <div 
                className={`flex items-center justify-between mb-3 ${configPanelFloating.isFloating ? 'cursor-move' : ''}`}
                onMouseDown={handleConfigPanelMouseDown}
              >
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  配置文件
                </h2>

                <div className="flex items-center gap-1">
                  {/* 浮动切换按钮 */}
                  <Button
                    size="sm"
                    variant={configPanelFloating.isFloating ? "default" : "outline"}
                    onClick={() => setConfigPanelFloating({
                      ...configPanelFloating,
                      isFloating: !configPanelFloating.isFloating,
                      x: 0,
                      y: 0,
                    })}
                    className="h-7 px-2 text-xs"
                    title={configPanelFloating.isFloating ? "固定位置" : "浮动模式"}
                  >
                    {configPanelFloating.isFloating ? "📌" : "🎯"}
                  </Button>

                  {/* 编辑模式切换按钮 */}
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant={isEditingConfig ? "default" : "outline"}
                      onClick={() => setIsEditingConfig(true)}
                      className="h-7 px-2 text-xs"
                      title="可视化编辑"
                    >
                      <Settings className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant={!isEditingConfig ? "default" : "outline"}
                      onClick={() => setIsEditingConfig(false)}
                      className="h-7 px-2 text-xs"
                      title="文本编辑"
                    >
                      <FileText className="w-3 h-3" />
                    </Button>
                  </div>

                  {/* 账单类型切换按钮 */}
                  <div className="w-px bg-slate-200 dark:bg-slate-700 mx-1"></div>
                  <Button
                    size="sm"
                    variant={billType === 'alipay' || (!billType && config === alipayConfig) ? "default" : "outline"}
                    onClick={() => handleSwitchBillType('alipay')}
                    className="h-7 px-2 text-xs"
                  >
                    支付宝
                  </Button>
                  <Button
                    size="sm"
                    variant={billType === 'wechat' || (!billType && config === wechatConfig) ? "default" : "outline"}
                    onClick={() => handleSwitchBillType('wechat')}
                    className="h-7 px-2 text-xs"
                  >
                    微信
                  </Button>
                </div>
              </div>

              {configLoading && (
                <div className="mb-3 p-2 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                  <p className="text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    正在加载配置...
                  </p>
                </div>
              )}

              {/* 文本编辑模式 */}
              {!isEditingConfig && (
                <Textarea
                  value={config}
                  onChange={(e) => setConfig(e.target.value)}
                  placeholder="请输入YAML格式的配置..."
                  className="min-h-[200px] max-h-[400px] overflow-y-auto font-mono text-xs bg-slate-50 dark:bg-slate-950/50"
                  disabled={configLoading}
                />
              )}

              {/* 可视化编辑模式 */}
              {isEditingConfig && parsedConfig && (
                <div className="min-h-[200px] max-h-[400px] overflow-y-auto">
                  {(() => {
                    const { peerRules, methodRules } = getRulesByType();
                    
                    return (
                      <div className="space-y-4">
                        {/* 交易对方规则 */}
                        <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                              <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                              交易对方规则
                            </h3>
                            <Button
                              size="sm"
                              onClick={() => handleAddRule('peer')}
                              className="h-6 px-2 text-xs"
                            >
                              <Plus className="w-3 h-3 mr-1" />
                              添加
                            </Button>
                          </div>
                          
                          {peerRules.length === 0 ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-2">
                              暂无交易对方规则
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {peerRules.map((rule: any, index: number) => (
                                <div
                                  key={`peer-${index}`}
                                  className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-950/30 rounded border border-slate-200 dark:border-slate-800"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs font-medium text-slate-900 dark:text-slate-50 truncate">
                                      {rule.peer}
                                    </div>
                                    <div className="text-xs text-slate-600 dark:text-slate-400">
                                      目标: {rule.targetAccount || '-'}
                                    </div>
                                    {rule.methodAccount && (
                                      <div className="text-xs text-slate-600 dark:text-slate-400">
                                        支付账户: {rule.methodAccount}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex gap-1 ml-2">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleEditRule('peer', index)}
                                      className="h-6 w-6 p-0"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleDeleteRule('peer', index)}
                                      className="h-6 w-6 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* 支付方式规则 */}
                        <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                              <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                              支付方式规则
                            </h3>
                            <Button
                              size="sm"
                              onClick={() => handleAddRule('method')}
                              className="h-6 px-2 text-xs"
                            >
                              <Plus className="w-3 h-3 mr-1" />
                              添加
                            </Button>
                          </div>
                          
                          {methodRules.length === 0 ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-2">
                              暂无支付方式规则
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {methodRules.map((rule: any, index: number) => (
                                <div
                                  key={`method-${index}`}
                                  className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-950/30 rounded border border-slate-200 dark:border-slate-800"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs font-medium text-slate-900 dark:text-slate-50 truncate">
                                      {rule.method}
                                    </div>
                                    <div className="text-xs text-slate-600 dark:text-slate-400">
                                      支付账户: {rule.methodAccount || '-'}
                                    </div>
                                    {rule.targetAccount && (
                                      <div className="text-xs text-slate-600 dark:text-slate-400">
                                        目标: {rule.targetAccount}
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex gap-1 ml-2">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleEditRule('method', index)}
                                      className="h-6 w-6 p-0"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleDeleteRule('method', index)}
                                      className="h-6 w-6 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* 规则编辑对话框 */}
              {showRuleEditor && editingRule && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div className="absolute inset-0 bg-black/50" onClick={handleCancelRuleEdit}></div>
                  <div className="relative bg-white dark:bg-slate-900 rounded-xl shadow-lg p-6 max-w-md w-full">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50 mb-4">
                      {ruleType === 'peer' ? '编辑交易对方规则' : '编辑支付方式规则'}
                    </h3>
                    
                    <div className="space-y-4">
                      {ruleType === 'peer' && (
                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                            交易对方 <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={editingRule.peer || ''}
                            onChange={(e) => setEditingRule({ ...editingRule, peer: e.target.value })}
                            placeholder="例如：麦当劳"
                            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50"
                          />
                        </div>
                      )}
                      
                      {ruleType === 'method' && (
                        <div>
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                            支付方式 <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={editingRule.method || ''}
                            onChange={(e) => setEditingRule({ ...editingRule, method: e.target.value })}
                            placeholder="例如：余额宝"
                            className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50"
                          />
                        </div>
                      )}
                      
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                          目标账户
                        </label>
                        <input
                          type="text"
                          value={editingRule.targetAccount || ''}
                          onChange={(e) => setEditingRule({ ...editingRule, targetAccount: e.target.value })}
                          placeholder="例如：Expenses:Food"
                          className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                          支付账户
                        </label>
                        <input
                          type="text"
                          value={editingRule.methodAccount || ''}
                          onChange={(e) => setEditingRule({ ...editingRule, methodAccount: e.target.value })}
                          placeholder="例如：Assets:Alipay"
                          className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-50"
                        />
                      </div>
                    </div>
                    
                    <div className="flex justify-end gap-2 mt-6">
                      <Button
                        variant="outline"
                        onClick={handleCancelRuleEdit}
                      >
                        取消
                      </Button>
                      <Button
                        onClick={handleSaveRule}
                        disabled={!editingRule || (!editingRule.peer && ruleType === 'peer') || (!editingRule.method && ruleType === 'method')}
                      >
                        <Save className="w-4 h-4 mr-2" />
                        保存
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Result */}
          <div className="col-span-12 lg:col-span-8">
            {/* Result Section */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm p-4 border border-slate-200 dark:border-slate-800 h-full flex flex-col">
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  转换结果
                </h2>

                {result && (
                  <Button onClick={handleDownload} size="sm" variant="outline">
                    <Download className="w-4 h-4 mr-2" />
                    下载文件
                  </Button>
                )}
              </div>

              {error && (
                <Alert variant="destructive" className="mb-3 flex-shrink-0">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="text-sm">{error}</div>
                    {error.includes('文件为空或格式不正确') && (
                      <div className="mt-2 text-xs opacity-90">
                        <p>支持的文件格式：</p>
                        <ul className="list-disc list-inside">
                          <li>支付宝账单 (CSV/XLSX)</li>
                          <li>微信账单 (CSV/XLSX)</li>
                        </ul>
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {result && result.success && (
                <div className="flex flex-col flex-1 overflow-hidden">
                  {/* Summary - Compact */}
                  <div className="bg-slate-50 dark:bg-slate-950/50 rounded-lg p-3 mb-3 flex-shrink-0">
                    <div className="grid grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-slate-600 dark:text-slate-400">类型:</span>
                        <span className="ml-1 text-slate-900 dark:text-slate-50 font-medium">
                          {result.summary.billType}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-600 dark:text-slate-400">成功:</span>
                        <span className="ml-1 text-emerald-600 dark:text-emerald-400 font-medium">
                          {result.summary.successCount}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-600 dark:text-slate-400">跳过:</span>
                        <span className="ml-1 text-amber-600 dark:text-amber-400 font-medium">
                          {result.summary.skippedCount}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-600 dark:text-slate-400">时间:</span>
                        <span className="ml-1 text-slate-900 dark:text-slate-50">
                          {result.summary.timestamp}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Preview - Maximized with light background */}
                  <div className="flex-1 overflow-hidden rounded-lg bg-slate-50 border border-slate-200">
                    <pre className="text-xs text-slate-900 font-mono whitespace-pre-wrap p-4 overflow-auto h-full">
                      {result.beancountContent}
                    </pre>
                  </div>
                </div>
              )}

              {!result && !error && (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                  <FileText className="w-20 h-20 mb-3 opacity-30" />
                  <p className="text-sm">上传文件并点击转换按钮查看结果</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
