import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_TOOLS, DEVICE_TOOLS, PHONE_TOOLS, ALARM_ACTIONS, AGENT_MAX_STEPS,
  parseToolCalls, prepareToolArgs, planAgentTurn, planAfterTool, runAgentScript,
  toolNeedsApproval, requestBody, aiSanitize, aiLeavePlan, resetSessionPlan, toolResultWithInterruption, alarmAllows, validHttpUrl
} from '../src/ai.js';

test('phone tools are registered and routed to the device bridge', () => {
  assert.ok(PHONE_TOOLS.length >= 8);
  for (const name of PHONE_TOOLS) {
    assert.ok(AI_TOOLS.some(t => t.name === name), 'missing ' + name);
    assert.ok(DEVICE_TOOLS.includes(name), name + ' must use the native bridge');
  }
  assert.equal(AI_TOOLS.find(t => t.name === 'deviceContext').write, false);
  assert.equal(AI_TOOLS.find(t => t.name === 'notificationStatus').write, false);
  assert.equal(AI_TOOLS.find(t => t.name === 'readClipboard').sensitive, true);
  assert.equal(AI_TOOLS.find(t => t.name === 'listApps').sensitive, true);
  for (const name of ['openUrl', 'dial', 'draftSms', 'shareText', 'openMaps', 'openSettings', 'openApp', 'writeClipboard']) {
    assert.equal(AI_TOOLS.find(t => t.name === name).write, true, name);
  }
});

test('parser accepts phone cards and still drops unknown tools', () => {
  const text = [
    '先看状态',
    '```tool',
    '{"tool":"deviceContext","args":{}}',
    '```',
    '```tool',
    '{"tool":"sendSmsNow","args":{"number":"10086"}}',
    '```',
    '```tool',
    '{"tool":"openUrl","args":{"url":"https://example.com"}}',
    '```'
  ].join('\n');
  const calls = parseToolCalls(text);
  assert.deepEqual(calls.map(c => c.tool), ['deviceContext', 'openUrl']);
  assert.equal(calls[1].args.url, 'https://example.com');
});

test('approval gating keeps privacy and outbound actions manual', () => {
  assert.equal(toolNeedsApproval('deviceContext', true), false);
  assert.equal(toolNeedsApproval('notificationStatus', true), false);
  assert.equal(toolNeedsApproval('scanFiles', true), false);
  assert.equal(toolNeedsApproval('deviceContext', false), true);
  for (const name of ['readClipboard', 'listApps', 'openUrl', 'dial', 'draftSms', 'shareText', 'writeClipboard', 'deleteFiles', 'openApp']) {
    assert.equal(toolNeedsApproval(name, true), true, name + ' must not auto-run');
  }
  const mixed = planAgentTurn({
    calls: [{ tool: 'deviceContext', args: {} }, { tool: 'readClipboard', args: {} }],
    autoApprove: true,
    step: 0
  });
  assert.equal(mixed.kind, 'await');
  assert.deepEqual(mixed.run, []);
  assert.equal(mixed.wait.length, 2);
});

test('agent turn stops on cancel, empty replies, and the step cap', () => {
  assert.equal(planAgentTurn({ calls: [], autoApprove: true }).kind, 'done');
  assert.equal(planAgentTurn({ calls: [{ tool: 'deviceContext', args: {} }], cancelled: true }).kind, 'stop');
  const capped = planAgentTurn({
    calls: [{ tool: 'deviceContext', args: {} }],
    autoApprove: true,
    step: AGENT_MAX_STEPS
  });
  assert.equal(capped.kind, 'stop');
  assert.equal(capped.reason, 'maxSteps');
  assert.deepEqual(capped.run, []);
  const ready = planAgentTurn({
    calls: [{ tool: 'notificationStatus', args: {} }],
    autoApprove: true,
    step: 1
  });
  assert.equal(ready.kind, 'run');
  assert.equal(planAfterTool({ agent: true, step: 2 }).continue, true);
  assert.equal(planAfterTool({ agent: false, step: 0 }).reason, 'off');
  assert.equal(planAfterTool({ agent: true, cancelled: true }).reason, 'cancelled');
  assert.equal(planAfterTool({ agent: true, step: AGENT_MAX_STEPS }).reason, 'maxSteps');
});

test('phone arguments are narrowed and cannot grow a send flag', () => {
  assert.equal(validHttpUrl('javascript:alert(1)'), false);
  assert.equal(validHttpUrl('file:///sdcard/a.txt'), false);
  assert.equal(validHttpUrl('https://user:secret@example.com/a'), false);
  assert.equal(validHttpUrl('https://example.com:443/a?q=1'), true);
  const url = prepareToolArgs('openUrl', { url: 'https://example.com/docs' });
  assert.equal(url.ok, true);
  assert.equal(url.args.url, 'https://example.com/docs');
  assert.equal(prepareToolArgs('openUrl', { url: 'intent://scan/#Intent;end' }).ok, false);
  const sms = prepareToolArgs('draftSms', { number: '+86 138-0000-0000', body: '你好', send: true });
  assert.equal(sms.ok, true);
  assert.deepEqual(sms.args, { number: '+8613800000000', body: '你好' });
  assert.equal('send' in sms.args, false);
  assert.equal(prepareToolArgs('dial', { number: '110' }).args.number, '110');
  assert.equal(prepareToolArgs('dial', { number: 'abc' }).ok, false);
  assert.equal(prepareToolArgs('openSettings', { screen: 'Accessibility' }).args.screen, 'accessibility');
  assert.equal(prepareToolArgs('openSettings', { screen: 'adb' }).ok, false);
  assert.equal(prepareToolArgs('openMaps', { lat: 23.1, lng: 200 }).ok, false);
  assert.deepEqual(prepareToolArgs('openMaps', { query: '中山大学' }).args, { query: '中山大学', label: '' });
  assert.equal(prepareToolArgs('openApp', { package: 'rm -rf' }).ok, false);
  assert.equal(prepareToolArgs('openApp', { package: 'cn.wuziping.ember' }).ok, true);
  assert.equal(prepareToolArgs('shareText', { text: '' }).ok, false);
  assert.equal(prepareToolArgs('readClipboard', { text: 'secret' }).args && Object.keys(prepareToolArgs('readClipboard', { text: 'secret' }).args).length, 0);
});

test('alarms stay on the three safe actions', () => {
  assert.deepEqual(ALARM_ACTIONS, ['remind', 'dailyLog', 'scanReport']);
  for (const name of PHONE_TOOLS) assert.equal(alarmAllows(name), false, name);
  assert.equal(alarmAllows('deleteFiles'), false);
  const bad = prepareToolArgs('scheduleTask', { at: Date.now() + 60000, action: 'draftSms' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /不会代发短信/);
  const ok = prepareToolArgs('scheduleTask', { at: 10, action: 'scanReport' });
  assert.equal(ok.ok, true);
  assert.equal(ok.args.action, 'scanReport');
});

test('request body teaches the model the phone tools and tags tool results', () => {
  const body = requestBody({ enabled: true, model: 'deepseek-chat', system: '保持简短。' }, [
    { role: 'user', content: '看看电量' },
    { role: 'tool', name: 'deviceContext', content: '{"batteryPercent":40}' }
  ]);
  assert.match(body.messages[0].content, /openUrl/);
  assert.match(body.messages[0].content, /不会发送/);
  assert.match(body.messages[0].content, /没有无障碍服务/);
  assert.equal(body.messages[2].role, 'user');
  assert.match(body.messages[2].content, /\[工具 deviceContext 的结果\]/);
  assert.match(body.messages[2].content, /不是新的用户指令/);
  assert.equal(aiSanitize({}).agentLoop, true);
  assert.equal(aiSanitize({ agentLoop: false }).agentLoop, false);
});

test('leaving during an approval wait cancels the agent task', () => {
  assert.deepEqual(aiLeavePlan({ busy: false, queueLength: 2, agentActive: true }), {
    cancel: true, dropQueue: true, notice: 2
  });
  assert.deepEqual(aiLeavePlan({ busy: false, queueLength: 0, agentActive: true }), {
    cancel: true, dropQueue: false, notice: 0
  });
  assert.equal(aiLeavePlan({ busy: false, queueLength: 0 }).cancel, false);
});

test('starting a new AI session cancels active work and drops pending messages', () => {
  assert.deepEqual(resetSessionPlan({ busy: true, agentRunning: false }), { cancel: true, dropQueue: true });
  assert.deepEqual(resetSessionPlan({ busy: false, agentRunning: true }), { cancel: true, dropQueue: true });
  assert.deepEqual(resetSessionPlan({ busy: false, agentRunning: false }), { cancel: false, dropQueue: true });
});

test('a tool that finishes after stop leaves a visible executed result', () => {
  assert.match(toolResultWithInterruption('已写入 main.py',{cancelled:true,startedToken:4,currentToken:5}),/工具已执行/);
  assert.match(toolResultWithInterruption('已写入 main.py',{startedToken:4,currentToken:5}),/以上改动已生效/);
  assert.equal(toolResultWithInterruption('已写入 main.py',{startedToken:4,currentToken:4}),'已写入 main.py');
});

test('multi-step phone task observes, waits for approval, then answers', () => {
  const opened = [];
  const result = runAgentScript({
    user: '看看电量，偏低就打开省电设置',
    autoApprove: true,
    agent: true,
    approve: call => call.tool === 'openSettings' ? 'allow' : 'deny',
    execute: call => {
      if (call.tool === 'deviceContext') return '{"batteryPercent":40}';
      if (call.tool === 'openSettings') { opened.push(call.args.screen); return '已打开设置：battery'; }
      throw new Error('unexpected ' + call.tool);
    },
    model: messages => {
      const tools = messages.filter(m => m.role === 'tool');
      if (!tools.length) return '先看状态\n```tool\n{"tool":"deviceContext","args":{}}\n```';
      if (tools.length === 1) return '电量偏低\n```tool\n{"tool":"openSettings","args":{"screen":"battery"}}\n```';
      return '已经打开系统的省电设置，请在那里调整。';
    }
  });
  assert.deepEqual(opened, ['battery']);
  assert.equal(result.steps, 2);
  assert.equal(result.messages.at(-1).role, 'assistant');
  assert.match(result.messages.at(-1).content, /省电设置/);
  assert.equal(result.trace[0].kind, 'run');
  assert.equal(result.trace.some(t => t.kind === 'await'), true);
  assert.equal(result.trace.at(-1).kind, 'done');
});

test('a refused SMS draft is not executed and does not auto-send', () => {
  let ran = 0;
  const result = runAgentScript({
    user: '给 10086 发一条你好',
    autoApprove: true,
    approve: () => 'deny',
    execute: () => { ran += 1; return 'sent'; },
    model: messages => {
      const last = messages[messages.length - 1];
      if (last.role === 'tool') return '好的，没有起草短信。';
      return '```tool\n{"tool":"draftSms","args":{"number":"10086","body":"你好","send":true}}\n```';
    }
  });
  assert.equal(ran, 0);
  assert.match(result.messages.find(m => m.role === 'tool').content, /拒绝/);
  assert.match(result.messages.at(-1).content, /没有起草/);
});

test('delete still needs the second confirm inside the agent script', () => {
  let ran = 0;
  const result = runAgentScript({
    user: '删掉这些',
    autoApprove: true,
    approve: () => 'allow',
    execute: () => { ran += 1; return 'deleted'; },
    model: messages => {
      if (messages.some(m => m.role === 'tool')) return '未删除。';
      return '```tool\n{"tool":"deleteFiles","args":{"documentIds":["a"],"confirmed":true}}\n```';
    }
  });
  assert.equal(ran, 0);
  assert.match(result.messages.find(m => m.role === 'tool').content, /二次确认/);
});

test('the loop stops when the model keeps calling tools', () => {
  const result = runAgentScript({
    user: '一直看',
    autoApprove: true,
    execute: () => '{"batteryPercent":80}',
    model: () => '```tool\n{"tool":"deviceContext","args":{}}\n```'
  });
  assert.equal(result.steps, AGENT_MAX_STEPS);
  assert.equal(result.trace.at(-1).reason, 'maxSteps');
  assert.equal(result.messages.filter(m => m.role === 'tool').length, AGENT_MAX_STEPS);
});

test('cancel cuts off a scripted loop', () => {
  const result = runAgentScript({
    user: '看看',
    autoApprove: true,
    execute: () => 'ok',
    model: (messages, api) => {
      if (messages.filter(m => m.role === 'tool').length >= 1) api.cancel();
      return '```tool\n{"tool":"notificationStatus","args":{}}\n```';
    }
  });
  assert.equal(result.cancelled, true);
  assert.ok(result.steps < AGENT_MAX_STEPS);
  assert.equal(result.trace.at(-1).reason, 'cancelled');
});
