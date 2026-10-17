// Terms of Service: one source for the Mini App page (#/terms) and the public server page (GET /terms).
// Same shape as the privacy policy, so both renderers are shared. This is not legal advice.
import type { Lang } from './i18n/index.ts';
import { BOT_USERNAME, type Policy } from './privacy.ts';

const ru: Policy = {
  title: 'Условия использования',
  updated: 'Обновлено: 17 октября 2026',
  intro:
    'Копейка — Telegram Mini App для учёта общих трат. Здесь коротко и без юридических формулировок: на что можно рассчитывать и какие правила. Пользуясь приложением, вы с ними согласны.',
  sections: [
    {
      heading: 'Что это такое',
      paragraphs: [
        'Копейка помогает записывать общие траты, считать, кто кому сколько должен, и предлагает план переводов. Сейчас приложение бесплатное и ничего не продаёт. Если появятся платные функции, мы расскажем об этом заранее и не станем списывать деньги без вашего согласия.',
      ],
    },
    {
      heading: 'Деньги',
      items: [
        'Приложение не проводит платежи, не хранит и не пересылает чьи-либо деньги. Оно только считает и показывает платёжные реквизиты участников группы.',
        'Переводы вы делаете сами, своим банком или другим способом. Мы не отвечаем за ошибки в реквизитах, потерянные или спорные переводы и за споры между участниками группы.',
        'Отметка «переведено» в приложении — просто запись, а не подтверждение платежа.',
      ],
    },
    {
      heading: 'Ваша ответственность',
      items: [
        'Вы отвечаете за точность того, что записываете: суммы, даты, доли и реквизиты. Расчёты верны настолько, насколько верны исходные данные.',
        'Перед переводом проверяйте реквизиты и сумму. Если сомневаетесь, уточните у участника группы напрямую.',
        'Не добавляйте чужие личные данные и реквизиты без ведома человека.',
        'Вы отвечаете за доступ к своему аккаунту Telegram.',
      ],
    },
    {
      heading: 'Честное использование',
      paragraphs: ['Нельзя:'],
      items: [
        'рассылать через бота и приложение спам, рекламу и нежелательные сообщения;',
        'использовать сервис для мошенничества, незаконных расчётов или травли участников;',
        'пытаться получить доступ к чужим группам и данным, обойти ограничения и защиту, создавать избыточную нагрузку на сервер, в том числе автоматическими запросами;',
        'выдавать себя за другого человека.',
      ],
    },
    {
      heading: 'Если правила нарушены',
      paragraphs: [
        'Мы можем ограничить доступ, удалить группу или заблокировать пользователя, который нарушает эти условия или вредит другим. По возможности сначала предупредим.',
      ],
    },
    {
      heading: 'Как есть',
      paragraphs: [
        'Сервис работает «как есть»: мы стараемся, чтобы он был стабильным и без ошибок, но не гарантируем бесперебойную работу и не отвечаем за убытки из-за сбоев, ошибок в расчётах или потери данных. Важные суммы лучше сверять самостоятельно. Свои данные можно в любой момент стереть кнопкой «Удалить мои данные» (подробности в политике конфиденциальности).',
      ],
    },
    {
      heading: 'Изменения',
      paragraphs: [
        'Мы можем менять приложение и эти условия, например добавлять и убирать функции. Новая версия появится на этой странице, дата вверху обновится. Если вы продолжаете пользоваться приложением, значит, вы согласны с новой версией.',
      ],
    },
    {
      heading: 'Связь',
      paragraphs: [
        `По любым вопросам напишите боту ${BOT_USERNAME} в Telegram. Как мы обращаемся с данными, описано в политике конфиденциальности. Этот текст — не юридическая консультация.`,
      ],
    },
  ],
};

const en: Policy = {
  title: 'Terms of Service',
  updated: 'Updated: October 17, 2026',
  intro:
    'Kopeika is a Telegram Mini App for tracking shared expenses. Here are the rules in plain language: what to expect and what we ask of you. By using the app you agree to them.',
  sections: [
    {
      heading: 'What this is',
      paragraphs: [
        'Kopeika helps you record shared expenses, work out who owes whom, and suggests a plan of transfers. Right now the app is free and sells nothing. If paid features appear, we will tell you in advance and will not charge you without your consent.',
      ],
    },
    {
      heading: 'Money',
      items: [
        'The app does not process payments and does not hold or move anyone’s money. It only calculates and shows the payment details of group members.',
        'You make transfers yourself, through your bank or any other way. We are not responsible for wrong payment details, lost or disputed transfers, or disagreements between group members.',
        'The “paid” mark in the app is just a note, not proof of payment.',
      ],
    },
    {
      heading: 'Your responsibility',
      items: [
        'You are responsible for the accuracy of what you enter: amounts, dates, shares and payment details. The calculations are only as right as the data behind them.',
        'Check the details and the amount before you send money. If in doubt, ask the group member directly.',
        'Do not add other people’s personal data or payment details without their knowledge.',
        'You are responsible for access to your Telegram account.',
      ],
    },
    {
      heading: 'Fair use',
      paragraphs: ['Please do not:'],
      items: [
        'send spam, ads or unwanted messages through the bot and the app;',
        'use the service for fraud, unlawful payments or harassment of members;',
        'try to access other people’s groups and data, bypass limits and protection, or overload the server, including with automated requests;',
        'pretend to be someone else.',
      ],
    },
    {
      heading: 'If the rules are broken',
      paragraphs: [
        'We may limit access, delete a group or block a user who breaks these terms or harms others. Where possible we will warn you first.',
      ],
    },
    {
      heading: 'As is',
      paragraphs: [
        'The service is provided “as is”: we try to keep it stable and bug-free, but we do not promise uninterrupted work and are not liable for losses caused by outages, calculation errors or data loss. Double-check important amounts yourself. You can erase your data at any time with “Delete my data” (details in the privacy policy).',
      ],
    },
    {
      heading: 'Changes',
      paragraphs: [
        'We may change the app and these terms, for example add or remove features. The new version will appear on this page and the date at the top will change. If you keep using the app, you agree to the new version.',
      ],
    },
    {
      heading: 'Contact',
      paragraphs: [
        `For any question, message the bot ${BOT_USERNAME} in Telegram. How we handle data is described in the privacy policy. This text is not legal advice.`,
      ],
    },
  ],
};

export const terms: Record<Lang, Policy> = { ru, en };
