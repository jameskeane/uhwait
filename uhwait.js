const async_hooks = require('async_hooks');
const util = require('util');

module.exports = { spawn, self, receive };

const state = {
  next_pid: 1,
  current_pid_id: 0,
  mailboxes: {},
  waiting: {},
  procs: {}
};
const pid_priv_props = new WeakMap();

// ====
// The async hooks, this is required because of the way node (v8) implements
// async/await; each call to await, and resolve from the promise are async; so
// we can't properly control `state.current_pid` unless we can hook into it.
const pid_async_map = {};
const pid_ref_count = {};

// console.log creates an async context, so calling it inside of the async hook
// can create an infinite loop.
function safe_print(...args) {
  // require('fs').writeSync(process.stdout.fd, `${util.format(...args)}\n`);
}

function destroy_hook(asyncId) {
  const pid = pid_async_map[asyncId];
  if (!pid) return;

  pid_ref_count[pid] -= 1;
  safe_print('destroy', pid, pid_ref_count[pid], asyncId)
  if (pid_ref_count[pid] === 0) {
    delete pid_ref_count[pid];
    state.current_pid_id = pid_async_map[asyncId];
    exit(0);
  }

  delete pid_async_map[asyncId];
  // state.current_pid_id = null;
}

const asyncHook = async_hooks.createHook({
  init(asyncId, type, triggerAsyncId, resource) {
    const pid = state.current_pid_id;
    safe_print('init', pid, asyncId, type);
    if (!pid || !(pid in state.procs)) return;
    pid_async_map[asyncId] = pid;
    pid_ref_count[pid] = (pid_ref_count[pid] || 0) + 1;
  },
  before(asyncId) {
    state.current_pid_id = pid_async_map[asyncId] || null;
  },
  after(asyncId) {
    state.current_pid_id = null;
  },
  // The `destroy` callback is unfortunately not called for promises until v8
  // garbage collects, so we destroy on resolve; not sure if this will bite us.
  promiseResolve(asyncId) {
    destroy_hook(asyncId);
  },
  destroy: destroy_hook
});
asyncHook.enable();


/**
 * Spawn a new 'process'. Creates a new process context and runs the provided
 * function inside of it. A process context allows the provided function to
 * receive messages from other processes.
 * @param  {Function} fn The function to run as a process.
 * @param  {any[]} args The arguments to call the function with.
 * @return {Pid} A reference to the processes 'pid'.
 */
function spawn(fn, args) {
  const pid = new Pid(state.next_pid++);
  state.procs[pid.id] = pid;
  // pid.__name = fn.name;
  _run_in_ctx(fn, args || [], pid.id);
  return pid;
}


/**
 * Return the 'pid' of the current running process. Works through nested async
 * calls.
 * @return {Pid} The pid of the current running process.
 */
function self() {
  if (!state.current_pid_id) throw new Error(`'self' must be called in a process context.`);
  return state.procs[state.current_pid_id];
}


/**
 * Wait for an incoming message sent to the current process.
 * @param  {number=} opt_timeout An optional maximum time in ms to wait.
 * @return {Promise.<any[]>} The first message received.
 */
function receive(opt_timeout) {
  if (!state.current_pid_id) throw new Error(`'receive' must be called in a process context.`);

  const current_pid = self();
  const current_pid_id = current_pid.id;

  if (current_pid_id in state.waiting) {
    throw new Error(`Proc ${current_pid_id} is already listening!`);
  }

  const { mailboxes, waiting } = state;
  if (current_pid_id in mailboxes) {
    let msg = mailboxes[current_pid_id].shift();
    if (mailboxes[current_pid_id].length === 0) delete mailboxes[current_pid_id];
    return Promise.resolve(msg);
  }

  return new Promise((resolve, reject) => {
    let timeout_id = null;
    if (opt_timeout) {
      timeout_id = setTimeout(() => {
        delete state.waiting[current_pid_id];
        reject('timeout');
      }, opt_timeout);
    }

    state.waiting[current_pid_id] = [current_pid_id, function(msg) {
      if (timeout_id) clearTimeout(timeout_id);
      timeout_id = null;
      resolve(msg);
    }];
  });
}


/**
 * Gracefully exit. Will destroy the current process context, resolving the
 * process' join promise is available.
 * @param  {number=} opt_reason The 'exit code' to exit with.
 */
function exit(opt_reason) {
  let proc = self();
  if (!proc || proc.exited) return;

  let priv = pid_priv_props.get(proc);
  priv.exited = true;
  priv.exit_reason = opt_reason || 0;

  delete state.waiting[proc.id];
  delete state.mailboxes[proc.id];
  delete state.procs[proc.id];

  if (priv.join_promise) {
    _run_in_ctx(priv.join_promise[1], [proc.exit_reason], 0);
  }
}


function _run_in_ctx(fn, args, pid) {
  let prev = state.current_pid_id;
  state.current_pid_id = pid;
  process.nextTick(fn.bind(fn, ...args));
  state.current_pid_id = prev;
}


/**
 * @constructor
 */
class Pid {
  constructor(id) {
    pid_priv_props.set(this, { id });
  }

  get id() { return pid_priv_props.get(this).id; }
  get exited() { return pid_priv_props.get(this).exited || false; }
  get exit_reason() { return pid_priv_props.get(this).exit_reason; }

  send(...args) {
    if (this.exited) throw new Error(`pid ${this.id} has exited`);

    if (state.waiting[this.id]) {
      let [pid_id, fn] = state.waiting[this.id];
      delete state.waiting[this.id];
      _run_in_ctx(fn, [args], pid_id);
    } else {
      state.mailboxes[this.id] = state.mailboxes[this.id] || [];
      state.mailboxes[this.id].push(args);
    }
  }

  join() {
    const priv = pid_priv_props.get(this);
    if (!priv.join_promise) {
      if (this.exited) return Promise.resolve(this.exit_reason);
      let resolver = null;
      let promise = new Promise((resolve) => { resolver = resolve; });
      priv.join_promise = [promise, resolver];
    }
    return priv.join_promise[0];
  }

  [util.inspect.custom]() {
    const if_exited = this.exited ? `, exit_reason: ${this.exit_reason}` : '';
    return `Pid { id: ${this.id}${if_exited} }`;
  }
}
