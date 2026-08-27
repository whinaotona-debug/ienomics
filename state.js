// アプリ全体のデータを一括管理するファイル

export const state = {
  // localStorageから読み込む初期データ
  role: localStorage.getItem('ienomics_role'), 
  familyCode: localStorage.getItem('ienomics_familyCode'),
  furigana: localStorage.getItem('ienomics_furigana') === 'true',
  
  // 画面の表示状態
  view: 'home',
  setupMode: null,
  setupStep: 1,
  isSending: false,
  message: '',
  requirePasswordSetup: false,
  resetPasswordCode: null,
  setupLoadingMessage: '',
  editingTemplateId: null,
  editingPaymentId: null,
  investRange: 'week', // 'day' | 'week' | 'month'
  investChartName: null, // グラフ。null / __total__ は合計。銘柄名ならその銘柄だけ
  // 月間予定カレンダー（日本時間の年月。selectedDay は 1〜31 か null）
  calendarYear: null,
  calendarMonth: null, // 1〜12
  calendarSelectedDay: null,
  
  // 親が管理する複数子供用データ（新規機能）
  children: [], 
  childName: '',
  
  // Firebaseから取得するデータ
  points: 0,
  stockCap: null, // 親が決める運用資産（評価額）の上限。元本上限ではない。未設定・新規は 10000。0 を保存すると制限なし
  marketSheetUrl: '',      // 相場を読むスプレッドシートのURL
  marketSheetStatus: 'off', // 'off' | 'loading' | 'ok' | 'error'
  marketSheetMarkets: [],   // 表から読めた市場名
  marketSheetUpdatedAt: null,
  marketSheetError: '',
  marketNews: [], // 学習用解説 { about, title, what/why/life/stocks, body, url, source }
  marketNewsUpdatedAt: '',
  marketNewsKind: 'market',
  marketNewsDisclaimer: '',
  childLinked: true,
  tasks: [],
  taskTemplates: [],
  tickets: [],
  wishes: [],
  investments: [],
  investmentLogs: [], // 株の売買ログ（売っても残る。グラフ用）
  exchanges: [],
  banks: [],    
  balloons: [],
  scheduledPayments: [],
  paymentLogs: [],
  isInitialLoad: true,
  tasksReady: false
};