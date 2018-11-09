const { self, receive, spawn } = require('../uhwait');


async function hello() {
  const [msg] = await receive();
  if (msg === 'exit') return;

  console.log(`hello ${msg} from pid(${self().id})`);  

  // process context is fully tracked through async continuations
  console.log('let\'s wait for a sec.');
  setTimeout(() => {
    console.log(`still me, pid(${self().id})`);
    hello();
  }, 1000);
}

async function watcher(pid) {
  console.log(`pid(${self().id}) watching pid(${pid.id})`);
  let exit_reason = await pid.join();
  console.log(`pid ${pid.id} exited with ${exit_reason}`);
}


async function start() {
  const hello_pid = spawn(hello);
  const watch_pid = spawn(watcher, [hello_pid]);

  hello_pid.send('world');
  hello_pid.send('world!!');
  hello_pid.send('exit');
  hello_pid.send('world');

  await watch_pid.join();
  console.log('done');
}
start();
