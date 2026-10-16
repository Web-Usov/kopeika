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

const ru: Policy = {
  title: 'Политика конфиденциальности',
  updated: 'Обновлено: 17 октября 2026',
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
        'Сам Telegram видит всё, что вы делаете в Telegram, по своим правилам.',
      ],
    },
    {
      heading: 'Где и сколько хранится',
      paragraphs: [
        'Данные лежат в базе на сервере владельца приложения. Пока вы пользуетесь Копейкой, они хранятся. Раз в сутки сервер делает резервную копию базы и держит последние 14 копий; после удаления данных они исчезнут и из копий в течение 14 дней. Отдельно владелец видит обезличенную статистику использования: дневные суммы по видам действий (сколько групп и трат создано и т. п.) и число активных пользователей — без имён, идентификаторов и содержимого.',
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
        'удаляются ваши имя, username, фото, язык, платёжные реквизиты и настройки уведомлений;',
        'удаляются ваши напоминания и ссылки для привязки чатов; регулярные траты, которые вы создали, ставятся на паузу (группа может включить их снова);',
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
};

const en: Policy = {
  title: 'Privacy Policy',
  updated: 'Updated: October 17, 2026',
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
        'Telegram itself sees whatever you do in Telegram, under its own rules.',
      ],
    },
    {
      heading: 'Where and for how long',
      paragraphs: [
        'Data lives in a database on the app owner’s server and is kept while you use Kopeika. Once a day the server makes a database backup and keeps the last 14; after you delete your data it disappears from the backups within 14 days. Separately, the owner sees anonymous usage statistics: daily totals per kind of action (how many groups and expenses were created, etc.) and the number of active users, with no names, IDs or content.',
      ],
    },
    {
      heading: 'How to delete your data',
      paragraphs: ['On the app’s home screen tap “Delete my data” (you confirm twice). What happens:'],
      items: [
        'in every group that has other members with Telegram, you become a member without Telegram under the same name: other people’s expenses and balances do not change, and the next member becomes the group owner;',
        'groups where you were the only member with Telegram are deleted entirely, with their expenses and history;',
        'your name, username, photo, language, payment details and notification settings are deleted;',
        'your reminders and chat-linking links are deleted; recurring expenses you created are paused (the group can turn them back on);',
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
};

export const policies: Record<Lang, Policy> = { ru, en };
