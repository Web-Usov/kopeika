// Privacy policy: one source for the Mini App page (#/privacy) and the public server page (GET /privacy).
// Plain structured text, so both renderers stay trivial. Keep it in sync with what the code really stores
// (server/src/db.ts) and shows (repo.ts, bot.ts, inline.ts, export.ts). This is not legal advice.
import type { Lang } from './i18n/index.ts';

export interface PolicySection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
}

export interface Policy {
  title: string;
  updated: string;
  intro: string;
  sections: PolicySection[];
}

export const BOT_USERNAME = '@kopeika_usov_bot';

/** Who reads receipt photos (server RECEIPTS_PROVIDER); the policy names it and its retention rules. */
export type ReceiptsProvider = 'anthropic' | 'openrouter';

// Retention wording follows the providers' own docs: Anthropic API data usage; OpenRouter docs
// (guides/privacy/data-collection, guides/routing/provider-selection: `data_collection: 'deny'`, sent by
// server/src/receipts/openrouter.ts). Change it together with the provider code.
const receiptsRu: Record<ReceiptsProvider, { recipient: string; retention: string }> = {
  anthropic: {
    recipient: 'на сервис распознавания (Anthropic)',
    retention:
      'По документации Anthropic, её API по умолчанию не использует присланные данные для обучения моделей, но может хранить запросы на своей стороне до 30 дней (дольше — если запрос помечен как нарушающий правила сервиса).',
  },
  openrouter: {
    recipient: 'через сервис OpenRouter к компании, которая запускает модель распознавания',
    retention:
      'По документации OpenRouter, он не хранит содержимое запросов и не использует его для улучшения своего сервиса, если владелец аккаунта сам этого не включил (мы не включаем), а хранит только служебные данные запроса — число токенов, время ответа и т. п. Мы просим OpenRouter отправлять фото только тем компаниям, которые, по его словам, не собирают данные пользователей. Но у каждой из них свои правила хранения, и проверить их сами мы не можем.',
  },
};

const receiptsEn: Record<ReceiptsProvider, { recipient: string; retention: string }> = {
  anthropic: {
    recipient: 'to a recognition service (Anthropic)',
    retention:
      'According to Anthropic’s documentation, its API does not use submitted data to train models by default, but may keep requests on its side for up to 30 days (longer if a request is flagged as violating the service’s usage policy).',
  },
  openrouter: {
    recipient: 'through the OpenRouter service to the company that runs the recognition model',
    retention:
      'According to OpenRouter’s documentation, it does not store the content of requests or use it to improve its service unless the account owner opts in (we do not), and keeps only request metadata such as token counts and latency. We ask OpenRouter to send the photo only to companies that, according to OpenRouter, do not collect user data. Each of them has its own retention rules, though, and we cannot check them ourselves.',
  },
};

const ru = (r: ReceiptsProvider): Policy => ({
  title: 'Политика конфиденциальности',
  updated: 'Обновлено: 28 октября 2026',
  intro:
    'Копейка — Telegram Mini App для учёта общих трат. Здесь коротко и без юридических формулировок: что мы храним, зачем, кто это видит и как всё удалить.',
  sections: [
    {
      heading: 'Что мы храним',
      paragraphs: ['Из Telegram, когда вы открываете приложение или пишете боту:'],
      items: [
        'ваш Telegram ID, имя и фамилия, username, ссылка на фото профиля (само фото мы не копируем) и язык интерфейса;',
        'разрешили ли вы боту писать вам (для уведомлений).',
      ],
    },
    {
      heading: 'Что вы вводите сами',
      items: [
        'группы: название, валюта, участники (включая имена людей без Telegram, которых добавили вы или другие участники);',
        'траты и переводы: название, сумма, категория, дата, кто платил и как поделено; для трат в другой валюте — исходная сумма и курс;',
        'платёжные реквизиты, если вы их указали: телефон, банк, номер карты, ссылка, заметка;',
        'регулярные траты и напоминания о долгах;',
        'история изменений группы: кто, что и когда изменил (названия, суммы и имена на тот момент).',
      ],
    },
    {
      heading: 'Зачем',
      paragraphs: [
        'Только чтобы приложение работало: считать балансы и план переводов, показывать историю, присылать уведомления и сообщения в привязанный чат. Мы не показываем рекламу, не продаём данные и не отдаём их третьим лицам. Приложение не проводит платежи и не хранит чужие деньги — реквизиты только показываются участникам группы.',
      ],
    },
    {
      heading: 'Кто это видит',
      items: [
        'Участники группы видят имена других участников, их username и фото, траты, балансы, историю и платёжные реквизиты (чтобы вам могли перевести).',
        'Тот, у кого есть ссылка-приглашение, видит название группы, валюту, число участников и имена участников без Telegram, чтобы выбрать себя.',
        'Если к группе привязан чат, бот пишет туда о тратах и ежедневные сводки (названия, суммы, имена); команда /balance в чате показывает балансы группы всем его участникам. Эти сообщения становятся частью чата в Telegram, и удалить их из Telegram мы не можем.',
        'Через инлайн-режим бота вы сами можете отправить в любой чат карточку с балансом группы: в ней названия, имена и суммы.',
        'Выгрузка в CSV уходит только вам, в личные сообщения от бота.',
        'Курсы валют мы запрашиваем у сайта Банка России (cbr-xml-daily.ru): уходит только код валюты и дата, личных данных нет.',
        `Если вы разбираете чек по фото, снимок отправляется ${receiptsRu[r].recipient}, чтобы получить список позиций. Перед первым сканированием приложение спросит ваше согласие, и мы его запомним. В демо-группе чеки не работают. На фото могут попасть название заведения, время и чужие позиции — не снимайте то, что не хотите отправлять третьей стороне, и закройте номер карты. Идентификаторы Telegram и имена участников мы в запрос не включаем. Позиции можно ввести и вручную, без отправки фото.`,
        'Сам Telegram видит всё, что вы делаете в Telegram, по своим правилам.',
      ],
    },
    {
      heading: 'Где и сколько хранится',
      paragraphs: [
        'Данные лежат в базе на сервере владельца приложения. Пока вы пользуетесь Копейкой, они хранятся. Раз в сутки сервер делает резервную копию базы и держит последние 14 копий; после удаления данных они исчезнут и из копий в течение 14 дней. Отдельно владелец видит обезличенную статистику использования: дневные суммы по видам действий (сколько групп и трат создано и т. п.) и число активных пользователей — без имён, идентификаторов и содержимого.',
        `Фото чека мы не сохраняем: оно живёт в памяти сервера только на время запроса и не попадает ни на диск, ни в логи. Распознанные позиции тоже не сохраняются — в трате остаются только итоговые доли. Мы учитываем лишь число сканирований и их стоимость (модель, число токенов, цена) — для лимитов и месячного бюджета, без содержимого чека. ${receiptsRu[r].retention}`,
        'Если в приложении или на сервере случается ошибка, владельцу может уйти технический отчёт: текст ошибки, несколько строк кода, экран без номеров и кодов, версия приложения и Telegram. Имён, сумм, названий трат, идентификаторов и данных входа Telegram в нём нет.',
      ],
    },
    {
      heading: 'Как удалить свои данные',
      paragraphs: [
        'На главном экране приложения нажмите «Удалить мои данные» (нужно подтвердить дважды). Что при этом произойдёт:',
      ],
      items: [
        'в каждой группе, где есть другие участники с Telegram, вы станете участником без Telegram с тем же именем: траты и балансы остальных не меняются, а владельцем группы станет следующий участник;',
        'группы, где вы были единственным участником с Telegram, удаляются целиком, вместе с тратами и историей;',
        'удаляются ваши имя, username, фото, язык, платёжные реквизиты, настройки уведомлений и согласие на распознавание чеков; записи о сканах чеков (только число и стоимость) отвязываются от вас и остаются без имени как учёт расхода на месячный бюджет;',
        'удаляются ваши напоминания и ссылки и запросы для привязки чатов; регулярные траты, которые вы создали, ставятся на паузу (группа может включить их снова);',
        'в истории групп записи остаются, но вместо вашего имени там «удалённый пользователь». Названия трат и имя, под которым вы были в группе, остаются в старых записях у остальных участников — как после выхода из группы;',
        'сообщения бота, уже отправленные в Telegram-чаты, остаются в этих чатах.',
      ],
    },
    {
      heading: 'Если вернуться',
      paragraphs: [
        'После удаления приложение не блокирует вас: если вы снова откроете Копейку, для вашего Telegram-аккаунта будет создана новая пустая запись. Прежние группы не вернутся, пока вас снова не пригласят.',
      ],
    },
    {
      heading: 'Связь',
      paragraphs: [
        `По любым вопросам о данных напишите боту ${BOT_USERNAME} в Telegram. Если мы изменим эту политику, новая версия появится на этой странице.`,
      ],
    },
  ],
});

const en = (r: ReceiptsProvider): Policy => ({
  title: 'Privacy Policy',
  updated: 'Updated: October 28, 2026',
  intro:
    'Kopeika is a Telegram Mini App for splitting shared expenses. This is a short, plain-language description of what we store, why, who can see it and how to delete it all.',
  sections: [
    {
      heading: 'What we store',
      paragraphs: ['From Telegram, when you open the app or message the bot:'],
      items: [
        'your Telegram ID, first and last name, username, a link to your profile photo (we do not copy the photo itself) and your interface language;',
        'whether you allowed the bot to message you (for notifications).',
      ],
    },
    {
      heading: 'What you enter',
      items: [
        'groups: name, currency, members (including names of people without Telegram added by you or by other members);',
        'expenses and transfers: title, amount, category, date, who paid and how it was split; for expenses in another currency, the original amount and the rate;',
        'payment details, if you add them: phone, bank, card number, link, note;',
        'recurring expenses and debt reminders;',
        'the group change history: who changed what and when (titles, amounts and names as they were at that moment).',
      ],
    },
    {
      heading: 'Why',
      paragraphs: [
        'Only to make the app work: calculate balances and the transfer plan, show history, send notifications and messages to a linked chat. We show no ads, do not sell data and do not share it with third parties. The app does not process payments or hold anyone’s money; payment details are only shown to group members.',
      ],
    },
    {
      heading: 'Who can see it',
      items: [
        'Group members see the other members’ names, usernames and photos, expenses, balances, history and payment details (so that they can pay you).',
        'Anyone with an invite link sees the group name, currency, number of members and the names of members without Telegram, so they can pick themselves.',
        'If a chat is linked to a group, the bot posts expenses and daily summaries there (titles, amounts, names); the /balance command shows the group balances to everyone in that chat. Those messages become part of the Telegram chat and we cannot remove them from Telegram.',
        'With the bot’s inline mode you can send a group balance card to any chat yourself: it contains titles, names and amounts.',
        'The CSV export goes only to you, as a private message from the bot.',
        'We request exchange rates from the Bank of Russia website (cbr-xml-daily.ru): only a currency code and a date are sent, no personal data.',
        `If you scan a receipt photo, the image is sent ${receiptsEn[r].recipient} to get the list of items. The app asks for your consent before the first scan, and we remember it. Receipts do not work in the demo group. A photo can include the venue name, the time and other people’s items, so do not photograph anything you would not want to send to a third party, and cover the card number. We do not include Telegram identifiers or member names in the request. You can always enter the items by hand without sending a photo.`,
        'Telegram itself sees whatever you do in Telegram, under its own rules.',
      ],
    },
    {
      heading: 'Where and for how long',
      paragraphs: [
        'Data lives in a database on the app owner’s server and is kept while you use Kopeika. Once a day the server makes a database backup and keeps the last 14; after you delete your data it disappears from the backups within 14 days. Separately, the owner sees anonymous usage statistics: daily totals per kind of action (how many groups and expenses were created, etc.) and the number of active users, with no names, IDs or content.',
        `We do not store receipt photos: the image lives in the server’s memory only for the duration of the request and never reaches the disk or the logs. Recognized items are not stored either; an expense keeps only the final shares. We record only the number of scans and their cost (model, token count, price) for limits and the monthly budget, never the content of a receipt. ${receiptsEn[r].retention}`,
        'When an error happens in the app or on the server, a technical report may be sent to the owner: the error text, a few lines of code, the screen without numbers or codes, and the app and Telegram versions. It contains no names, amounts, expense titles, identifiers or Telegram sign-in data.',
      ],
    },
    {
      heading: 'How to delete your data',
      paragraphs: ['On the app’s home screen tap “Delete my data” (you confirm twice). What happens:'],
      items: [
        'in every group that has other members with Telegram, you become a member without Telegram under the same name: other people’s expenses and balances do not change, and the next member becomes the group owner;',
        'groups where you were the only member with Telegram are deleted entirely, with their expenses and history;',
        'your name, username, photo, language, payment details, notification settings and receipt-scanning consent are deleted; receipt scan records (only count and cost) are detached from you and kept without a name as cost accounting for the monthly budget;',
        'your reminders and chat-linking links and requests are deleted; recurring expenses you created are paused (the group can turn them back on);',
        'history entries stay in the groups, but your name is replaced with “deleted user”. Expense titles and the name you had in the group remain in older entries for the other members, as after leaving a group;',
        'bot messages already sent to Telegram chats stay in those chats.',
      ],
    },
    {
      heading: 'If you come back',
      paragraphs: [
        'We do not block you after deletion: if you open Kopeika again, a new empty account is created for your Telegram user. Your old groups do not come back unless someone invites you again.',
      ],
    },
    {
      heading: 'Contact',
      paragraphs: [
        `For any question about your data, message the bot ${BOT_USERNAME} in Telegram. If we change this policy, the new version will appear on this page.`,
      ],
    },
  ],
});

export const policy = (lang: Lang, provider: ReceiptsProvider): Policy => (lang === 'ru' ? ru : en)(provider);
