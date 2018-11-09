const { self, receive, spawn } = require('../uhwait');


async function hello() {
  const [msg] = await receive();
  if (msg === 'exit') return;

  console.log('hello', msg);  
  hello();
}

async function watcher(pid) {
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
