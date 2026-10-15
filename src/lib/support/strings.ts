/** All user-visible support-chat text in one place (the app has no i18n
 *  layer yet; when one is added, this is the only file to translate). */
export const S = {
  buttonLabel: '💬 დახმარება / Support',
  chatTitle: 'დახმარება',
  chatSubtitle: 'მხარდაჭერის ჩატი',
  back: '← უკან',
  you: 'თქვენ',
  supportTeam: 'CityRoute მხარდაჭერა',
  youAsSupport: 'თქვენ (მხარდაჭერა)',

  loading: 'იტვირთება...',
  loadError: 'ჩატის ჩატვირთვა ვერ მოხერხდა.',
  retry: 'ხელახლა ცდა',
  emptyTitle: 'მხარდაჭერასთან ჯერ არაფერი დაგიწერია',
  emptyText: 'აღწერე პრობლემა ან დაურთე ეკრანის სურათი. პასუხი აქვე გამოჩნდება.',
  loadOlder: 'ძველი შეტყობინებების ჩვენება',
  loadingOlder: 'იტვირთება...',

  placeholder: 'დაწერე შეტყობინება...',
  placeholderAdmin: 'დაწერე პასუხი...',
  send: 'გაგზავნა',
  attach: 'სურათის დართვა',
  removeImage: 'სურათის წაშლა',
  composerHint: 'Enter — გაგზავნა · Shift+Enter — ახალი ხაზი',

  sending: 'იგზავნება...',
  failed: 'ვერ გაიგზავნა',
  retrySend: 'ხელახლა გაგზავნა',
  discard: 'წაშლა',
  seen: 'ნანახია',
  uploading: (pct: number) => `სურათი იტვირთება ${pct}%`,

  imageTooBig: (name: string) => `„${name}“ 5 MB-ზე დიდია.`,
  imageBadType: (name: string) => `„${name}“ არ არის დაშვებული ფორმატი. გამოიყენე JPEG, PNG ან WebP.`,
  imageEmpty: (name: string) => `„${name}“ ცარიელია.`,
  imageUnreadable: (name: string) => `„${name}“ ვერ წაიკითხა.`,
  tooManyImages: (max: number) => `ერთ შეტყობინებაში მაქსიმუმ ${max} სურათია.`,
  bodyTooLong: (max: number) => `შეტყობინება ძალიან გრძელია (მაქსიმუმ ${max} სიმბოლო).`,
  imageLoadFailed: 'სურათი ვერ ჩაიტვირთა',
  closeImage: 'დახურვა',
  openImage: 'სურათის გადიდება',

  needLoginTitle: 'პირადი მხარდაჭერის ჩატისთვის საჭიროა შესვლა',
  needLoginText:
    'ჩატი მხოლოდ შენს ანგარიშზეა მიბმული, რათა მხარდაჭერამ შენი საუბარი დაინახოს და პასუხი სწორ ადამიანს გაუგზავნოს. შედი ანგარიშში ან მოგვწერე ელფოსტაზე.',
  login: 'შესვლა',
  register: 'რეგისტრაცია',
  orEmail: 'ან მოგვწერე ელფოსტაზე:',

  footerHelp: 'დახმარება',
  footerContact: 'მხარდაჭერა:',

  // errors coming back from the database / network
  errNetwork: 'ქსელის შეცდომა. შეამოწმე ინტერნეტი და სცადე ხელახლა.',
  errRateLimited: 'ძალიან ბევრი შეტყობინება ერთ წუთში. ცოტა ხანში სცადე.',
  errBodyTooLong: 'შეტყობინება ძალიან გრძელია.',
  errEmpty: 'შეტყობინება ცარიელია.',
  errTooManyAttachments: 'ძალიან ბევრი სურათია.',
  errAttachment: 'სურათის ატვირთვა ვერ მოხერხდა. სცადე ხელახლა.',
  errNotAuthenticated: 'სესია დასრულდა. შედი ანგარიშში თავიდან.',
  errNotConfigured: 'მხარდაჭერის ჩატი ჯერ არ არის გააქტიურებული. სცადე მოგვიანებით ან მოგვწერე ელფოსტაზე.',
  errGeneric: 'შეტყობინება ვერ გაიგზავნა. სცადე ხელახლა.',

  // admin
  adminTitle: 'მხარდაჭერის პანელი',
  adminForbiddenTitle: 'წვდომა შეზღუდულია',
  adminForbiddenText: 'ეს გვერდი მხოლოდ მხარდაჭერის ადმინისტრატორებისთვისაა.',
  adminChecking: 'წვდომის შემოწმება...',
  adminLogin: 'ადმინისტრატორის გვერდზე შესასვლელად ჯერ შედი ანგარიშში.',
  adminNoConversations: 'საუბრები არ არის',
  adminSelect: 'აირჩიე საუბარი მარცხნიდან',
  adminAll: 'ყველა',
  adminStatus: 'სტატუსი',
  adminUser: 'მომხმარებელი',
  adminRefresh: 'განახლება',
  adminListError: 'საუბრების ჩატვირთვა ვერ მოხერხდა.',
  adminBackToList: '← საუბრები',
  adminAnonymous: 'უსახელო მომხმარებელი',
  status: {
    open: 'ღია',
    waiting: 'პასუხის მოლოდინში',
    resolved: 'დახურული',
  } as const,
  today: 'დღეს',
  yesterday: 'გუშინ',
}

export type StatusKey = keyof typeof S.status
