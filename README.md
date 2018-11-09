# uhwait

A simple async/await gadget that adds seamless message passing to JavaScript.

```
npm install uhwait
```
Requires node.js >= v8.9.0. Previous versions of node have an incomplete version of the `async_hooks` implementation that will not work.


## Usage

uhwait is not intended to be used in a practical way, it's was written primarily to educate developers about message passing, actors, and concurrency.

uhwait provides `spawn`, `self`, and `receive` semantics, that when used with `async/await` (kind of) emulate the behaviour of [erlang](https://www.erlang.org/).

On top of those primitives, the `pid` object returned by spawn provides `pid.send(...args)` to send a message to the process, and `pid.join()` to wait until a process exits.

```javascript
const { self, receive, spawn } = require('uhwait');

async function hello() {
  const [msg] = await receive();
  console.log('hello', msg);
  hello();
}

async function watcher(pid) {
  await pid.join();
  console.log(`pid ${pid.id} exited with ${pid.exit_reason}`);
}


const hello = spawn(hello);
spawn(watcher, [hello]);
hello.send('world');
hello.send('world!!');
```

See `examples/` for more.

