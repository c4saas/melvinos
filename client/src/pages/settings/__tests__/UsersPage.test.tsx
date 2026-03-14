import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UsersOverviewSection, UserPlanDropdown, buildUsersOverviewMetrics, userPlanOptions } from '../UsersPage';
import type { AdminAssistantMetricsResponse, AdminUser } from '../types';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sampleUsers: AdminUser[] = [
  {
    id: 'user-1',
    name: 'Alice Example',
    email: 'alice@example.com',
    username: 'alice',
    plan: 'pro',
    role: 'admin',
    status: 'active',
  },
  {
    id: 'user-2',
    name: 'Bob Example',
    email: 'bob@example.com',
    username: 'bob',
    plan: 'free',
    role: 'user',
    status: 'suspended',
  },
  {
    id: 'user-3',
    name: 'Cara Example',
    email: 'cara@example.com',
    username: 'cara',
    plan: '',
    role: 'user',
    status: 'active',
  },
  {
    id: 'user-4',
    name: 'Dana Enterprise',
    email: 'dana@example.com',
    username: 'dana',
    plan: 'enterprise',
    role: 'user',
    status: 'active',
  },
];

const sampleAssistantMetrics: AdminAssistantMetricsResponse = {
  totalAssistants: 3,
  activeAssistants: 2,
  inactiveAssistants: 1,
  typeBreakdown: [
    { type: 'prompt', total: 2, active: 1, inactive: 1 },
    { type: 'webhook', total: 1, active: 1, inactive: 0 },
  ],
};

test('Users overview section renders summary cards with expected content', () => {
  void React;
  const metrics = buildUsersOverviewMetrics(sampleUsers);
  const markup = renderToStaticMarkup(
    createElement(UsersOverviewSection, {
      users: sampleUsers,
      metrics,
      assistantMetrics: sampleAssistantMetrics,
      assistantMetricsEnabled: true,
    })
  );

  const expectedTestIds = [
    'card-organizations',
    'card-plans',
    'card-assistant-library',
    'card-knowledge',
    'card-support',
  ];

  expectedTestIds.forEach((testId) => {
    assert.match(markup, new RegExp(escapeRegExp(`data-testid="${testId}"`)), `expected ${testId} to render`);
  });

  const expectedHeadings = [
    'Organizations / Teams',
    'User Plans &amp; Subscriptions',
    'User AI Agents',
    'User Knowledge &amp; Memory',
    'Support / Tickets',
  ];

  expectedHeadings.forEach((heading) => {
    assert.match(markup, new RegExp(escapeRegExp(heading)), `expected heading for ${heading}`);
  });

  assert.match(markup, /Active seats[^\d]*3/);
  assert.match(markup, /Suspended users[^\d]*1/);
  assert.match(markup, /User AI Agents/);
  assert.match(markup, /Active assistants[^\d]*2/);
  assert.match(markup, /Assistants published[^\d]*3/);
  assert.match(markup, /Prompt copilots/);
  assert.match(markup, /1\/2 active/);
  assert.match(markup, /Workflow copilots/);

  const summaryMap = new Map(metrics.planSummary.map((entry) => [entry.label, entry.count]));
  assert.equal(summaryMap.get('Pro'), 1);
  assert.equal(summaryMap.get('Free'), 1);
  assert.equal(summaryMap.get('Enterprise'), 1);
  assert.equal(summaryMap.get('Unassigned plan'), 1);
});

test('User plan dropdown renders trigger and available plan options', () => {
  void React;
  const planUser = sampleUsers[0];
  const markup = renderToStaticMarkup(
    createElement(UserPlanDropdown, {
      user: planUser,
      isUpdating: false,
      onSelect: () => {},
    })
  );

  assert.match(markup, new RegExp(escapeRegExp(`data-testid="button-plan-${planUser.id}"`)));
  userPlanOptions.forEach((option) => {
    assert.match(markup, new RegExp(escapeRegExp(option.label)));
    assert.match(markup, new RegExp(escapeRegExp(option.description)));
  });
});
