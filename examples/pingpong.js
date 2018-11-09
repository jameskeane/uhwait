const { self, receive, spawn } = require('../uhwait');

module.exports = { ping, pong };

// ping process
async function ping(n, pong_pid) {
  if (n === 0) {
    console.log('ping finished');
    pong_pid.send('finished');
    return;
  }

  pong_pid.send('ping', self());
  const [msg] = await receive();

  switch(msg) {
    case 'pong':
      console.log("ping received pong");
      ping(n - 1, pong_pid);
  }
}


// pong process
async function pong() {
  const [op, sender] = await receive();

  switch(op) {
    case 'finished':
      console.log('pong finished');
      break;

    case 'ping':
      console.log('pong received ping');
      sender.send('pong');
      pong();
  }
}

// start
async function start() {
  const pong_pid = spawn(pong, []);
  const ping_pid = spawn(ping, [3, pong_pid]);

  await Promise.all([ping_pid.join(), pong_pid.join()]);

  console.log('done', pong_pid, ping_pid);
}

spawn(start);
