// 两端共用的定点训练提示。目标来自服务端，绝不使用识别结果反推标签。
export function trainingOutcome(result) {
  if (!result) return '';
  if (result.outcome === 'net') return '未过网';
  if (result.outcome === 'miss') return '未击中球';
  return result.inTarget ? '落入目标区' : '落在目标区外';
}

export function mountTrainingUI(host, { onCommand, onChange = () => {} }) {
  let training = null;
  let context = { connected: false, canStart: false, canControl: false, hand: '', reason: '等待手机加入球场' };
  let pending = false;
  let pendingTimer = 0;
  let lastRenderSignature = '';
  host.innerHTML = `
    <div class="trainingIntro">
      <div><strong>定点训练</strong><p>固定站位，先看目标再挥拍 · 共 6 拍</p></div>
      <button class="trainingPrimary" data-action="start" disabled>定点训练</button>
    </div>
    <div class="trainingSession" hidden>
      <div class="trainingTop"><span>定点训练</span><span data-field="progress"></span></div>
      <div class="trainingPips" aria-hidden="true"></div>
      <div class="trainingPrompt" role="status" aria-live="polite" aria-atomic="true">
        <span class="trainingEyebrow" data-field="eyebrow">本拍提示目标</span>
        <h2 data-field="target"></h2>
        <p data-field="instruction"></p>
      </div>
      <div class="trainingCourt" aria-hidden="true">
        <svg viewBox="0 0 180 116">
          <rect x="29" y="4" width="122" height="108" rx="2" fill="none" stroke="currentColor"/>
          <path d="M29 58H151M90 4V112M29 30H151M29 85H151" fill="none" stroke="currentColor" opacity=".35"/>
          <rect data-map="target" y="8" width="30" height="17" rx="3" fill="#f8d477" opacity=".85"/>
          <path data-map="arrow" fill="none" stroke="#f8d477" stroke-width="2" stroke-dasharray="4 4"/>
          <circle cx="126" cy="96" r="5" fill="#7be2ff"/>
          <circle data-map="actual" r="4" fill="#fff" stroke="#102331" stroke-width="1.5" hidden/>
        </svg>
        <div><span><i class="trainingKey target"></i>提示目标区</span><span><i class="trainingKey stance"></i>固定站位 · 己方右后场</span><span data-field="actualKey" hidden><i class="trainingKey actual"></i>实际落点</span></div>
      </div>
      <div class="trainingResult" role="status" aria-live="polite" aria-atomic="true" hidden>
        <span class="trainingEyebrow">实际结果</span><strong data-field="outcome"></strong>
        <span data-field="next"></span>
      </div>
      <p class="trainingContext" data-field="context"></p>
      <p class="trainingRecording" data-field="recording"></p>
      <p class="trainingMeaning">提示目标用于采样，不代表已确认的真实意图；实际落点仅反映本次游戏出球。</p>
      <div class="trainingActions">
        <button data-action="retry" hidden>这拍重来</button>
        <button data-action="restart" class="trainingPrimary" hidden>再练一组</button>
        <button data-action="stop">退出训练</button>
      </div>
    </div>
    <p class="trainingAvailability" data-field="availability"></p>
    <p class="trainingError" role="alert" hidden></p>`;
  const field = (name) => host.querySelector(`[data-field="${name}"]`);
  const action = (name) => host.querySelector(`[data-action="${name}"]`);
  const error = host.querySelector('.trainingError');

  function render() {
    const signature = JSON.stringify([context, pending, training && [training.attemptId, training.status,
      training.index, training.completed, training.total, Math.ceil(training.remaining || 0),
      training.target, training.prompt, training.recording, training.result]]);
    if (signature === lastRenderSignature) return;
    lastRenderSignature = signature;
    const active = !!training?.active;
    host.dataset.active = String(active);
    host.querySelector('.trainingIntro').hidden = active;
    host.querySelector('.trainingSession').hidden = !active;
    field('availability').hidden = context.connected && (active ? context.canControl : context.canStart);
    field('availability').textContent = context.connected ? context.reason : '连接已断开，恢复连接后继续';
    action('start').disabled = pending || !context.connected || !context.canStart;
    if (!active) return;

    const complete = training.status === 'complete';
    const result = training.result;
    field('progress').textContent = complete
      ? `已完成 ${training.completed} / ${training.total} 拍`
      : `第 ${training.index + 1} / ${training.total} 拍`;
    const pips = host.querySelector('.trainingPips');
    if (pips.children.length !== training.total) pips.innerHTML = '<i></i>'.repeat(training.total);
    [...pips.children].forEach((pip, index) => {
      pip.className = index < training.completed ? 'done' : index === training.index ? 'current' : '';
    });
    field('eyebrow').textContent = complete ? '本组完成' : '本拍提示目标';
    field('target').textContent = complete ? `${training.completed} 拍训练完成` : training.target.label;
    field('instruction').textContent = complete ? '可以重来最后一拍，或再练一组。'
      : training.status === 'ready' ? `${training.prompt || '自然挥拍，把球打向亮起的目标区。'} 球固定在拍边，不用等时机。`
      : training.status === 'flying' ? '球已发出，观察实际落点。' : '看完结果会自动进入下一拍。';
    field('context').textContent = `${context.hand ? `${context.hand} · ` : ''}虚拟站位固定，无需移动`;
    field('recording').textContent = training.recording
      ? '记录已开启 · 提示目标与挥拍数据分开记录'
      : '记录未开启：本组训练数据不会保存';
    field('recording').classList.toggle('notRecording', !training.recording);
    host.querySelector('.trainingResult').hidden = !result;
    field('outcome').textContent = trainingOutcome(result);
    field('next').textContent = complete ? `最后一拍提示：${result?.requestedTarget?.label || training.target.label}`
      : training.status === 'result' ? `${Math.max(1, Math.ceil(training.remaining || 0))} 秒后自动下一拍` : '';
    action('retry').hidden = !result || !['result', 'complete'].includes(training.status);
    action('restart').hidden = !complete;
    for (const name of ['retry', 'restart', 'stop']) action(name).disabled = pending || !context.connected || !context.canControl;

    // 大屏左侧视角中，世界负 x 在画面右侧。
    const goalX = 90 - training.target.x * 20;
    host.querySelector('[data-map="target"]').setAttribute('x', String(goalX - 15));
    host.querySelector('[data-map="arrow"]').setAttribute('d', `M126 88L${goalX} 28m-5 6l5-6 5 6`);
    const actual = host.querySelector('[data-map="actual"]');
    const showActual = !!result?.actual && result.outcome === 'landed';
    actual.toggleAttribute('hidden', !showActual);
    field('actualKey').hidden = !showActual;
    if (showActual) {
      actual.setAttribute('cx', String(Math.max(5, Math.min(175, 90 - result.actual.x * 20))));
      actual.setAttribute('cy', String(Math.max(3, Math.min(113, 58 - result.actual.z * 8))));
    }
  }

  function reportError(message) {
    pending = false;
    clearTimeout(pendingTimer);
    error.textContent = message || '训练操作失败，请重试';
    error.hidden = false;
    render();
  }

  function command(name) {
    if (pending || !context.connected || (name === 'start' ? !context.canStart : !context.canControl)) return;
    pending = true;
    error.hidden = true;
    render();
    pendingTimer = setTimeout(() => reportError('暂未收到训练状态，请检查连接后重试。'), 5000);
    onCommand(`training:${name}`, name === 'retry' ? { attemptId: training?.attemptId } : {});
  }
  action('start').onclick = () => command('start');
  action('restart').onclick = () => command('start');
  action('retry').onclick = () => command('retry');
  action('stop').onclick = () => command('stop');
  render();

  return {
    start: () => command('start'),
    error: reportError,
    setContext(value) { context = { ...context, ...value }; render(); },
    setState(value) {
      training = value?.active ? value : null;
      pending = false;
      clearTimeout(pendingTimer);
      render();
      onChange(training);
    },
  };
}
