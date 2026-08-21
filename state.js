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
  investChartName: null, // グラフで見る銘柄。null なら先頭の保有
  // 月間予定カレンダー（日本時間の年月。selectedDay は 1〜31 か null）
  calendarYear: null,
  calendarMonth: null, // 1〜12
  calendarSelectedDay: null,
  
  // 親が管理する複数子供用データ（新規機能）
  children: [], 
  childName: '',
  
  // Firebaseから取得するデータ
  points: 0,
  stockCap: null, // 親が決める運用全体の評価額上限。初期作成時は 10000。null / 0 は制限なし
  marketSheetUrl: '',      // 相場を読むスプレッドシートのURL
  marketSheetStatus: 'off', // 'off' | 'loading' | 'ok' | 'error'
  marketSheetMarkets: [],   // 表から読めた市場名
  marketSheetUpdatedAt: null,
  marketSheetError: '',
  childLinked: true,
  tasks: [],
  taskTemplates: [],
  tickets: [],
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