/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

import DEBUG from "../../config/debug";
import ctx from "../../environment/ctx";
import indexOfAndSplice from "../../helpers/array/indexOfAndSplice";
import { IS_SERVICE_WORKER, IS_WORKER, notifyAll } from "../../helpers/context";
import EventListenerBase from "../../helpers/eventListenerBase";
import pause from "../../helpers/schedulers/pause";
import { Awaited, WorkerTaskTemplate, WorkerTaskVoidTemplate } from "../../types";
import { logger } from "../logger";

type SuperMessagePortTask = WorkerTaskTemplate & {
  transfer?: Transferable[]
};

interface InvokeTask extends SuperMessagePortTask {
  type: 'invoke',
  payload: WorkerTaskVoidTemplate & {withAck?: boolean, void?: boolean}
}

interface ResultTask extends SuperMessagePortTask {
  type: 'result',
  payload: {
    taskId: number,
    result?: any,
    error?: any
  }
}

interface AckTask extends SuperMessagePortTask {
  type: 'ack',
  payload: {
    cached: boolean,
    taskId: number
    result?: any,
    error?: any,
  }
}

interface PingTask extends SuperMessagePortTask {
  type: 'ping'
}

interface PongTask extends SuperMessagePortTask {
  type: 'pong'
}

interface BatchTask extends SuperMessagePortTask {
  type: 'batch',
  payload: Task[]
}

type Task = InvokeTask | ResultTask | AckTask | PingTask | PongTask | BatchTask;
type TaskMap = {
  [type in Task as type['type']]?: (task: Extract<Task, type>) => void | Promise<any>
};

export type AckedResult<T> = {
  cached: boolean,
  result: Promise<T>
};
// export type AckedResult<T> = {
//   cached: true,
//   result: T
// } | {
//   cached: false,
//   result: Promise<T>
// };

type ListenPort = WindowProxy | MessagePort | ServiceWorker | Worker | ServiceWorkerContainer;
type SendPort = WindowProxy | MessagePort | ServiceWorker | Worker;

type ListenerCallback = (payload: any, source: MessageEventSource, event: MessageEvent<any>) => any;
type Listeners = Record<string, ListenerCallback>;

const PING_INTERVAL = DEBUG || true ? 0x7FFFFFFF : 1000;
const PING_TIMEOUT = DEBUG || true ? 0x7FFFFFFF : 5000;

export default class SuperMessagePort<
  Workers extends Listeners, 
  Masters extends Listeners,
  IsMaster extends boolean,
  Receive extends Listeners = IsMaster extends true ? Masters : Workers,
  Send extends Listeners = IsMaster extends true ? Workers : Masters
> extends EventListenerBase<Receive> {
  protected listenPorts: Array<ListenPort>;
  protected sendPorts: Array<SendPort>;
  protected pingResolves: Map<SendPort, () => void>;

  protected taskId: number;
  protected awaiting: {
    [id: number]: {
      resolve: any,
      reject: any,
      taskType: string
    }
  };
  protected pending: Map<SendPort, Task[]>;

  protected log: ReturnType<typeof logger>;
  protected debug: boolean;
  protected releasingPending: boolean;

  public _constructor() {
    super._constructor(false);

    this.listenPorts = [];
    this.sendPorts = [];
    this.pingResolves = new Map();
    this.taskId = 0;
    this.awaiting = {};
    this.pending = new Map();
    this.log = logger('MP');
    this.debug = DEBUG;
  }

  public attachPort(port: MessageEventSource) {
    this.attachListenPort(port);
    this.attachSendPort(port);
  }

  public attachListenPort(port: ListenPort) {
    this.listenPorts.push(port);
    port.addEventListener('message', this.onMessage as any);
  }

  public attachSendPort(port: SendPort) {
    if((port as MessagePort).start) {
      (port as MessagePort).start();
    }

    this.sendPorts.push(port);
    this.sendPing(port);
  }

  protected sendPing(port: SendPort, loop = IS_WORKER) {
    let timeout: number;
    const promise = new Promise<void>((resolve, reject) => {
      this.pingResolves.set(port, resolve);
      this.pushTask(this.createTask('ping', undefined), port);

      timeout = ctx.setTimeout(() => {
        reject();
      }, PING_TIMEOUT);
    });

    promise.then(() => {
      clearTimeout(timeout);
      this.pingResolves.delete(port);

      if(loop) {
        this.sendPingWithTimeout(port);
      }
    }, () => {
      this.pingResolves.delete(port);

      indexOfAndSplice(this.listenPorts, port);
      indexOfAndSplice(this.sendPorts, port);
      if((port as MessagePort).close) {
        (port as MessagePort).close();
      }
    });
  }

  protected sendPingWithTimeout(port: SendPort, timeout = PING_INTERVAL) {
    ctx.setTimeout(() => {
      if(!this.sendPorts.includes(port)) {
        return;
      }

      this.sendPing(port);
    }, timeout);
  }

  protected postMessage(port: SendPort | SendPort[], task: Task) {
    const ports = Array.isArray(port) ? port : (port ? [port] : this.sendPorts);
    ports.forEach((port) => {
      port.postMessage(task, task.transfer as any);
    });
  }

  protected onMessage = (event: MessageEvent) => {
    const task: Task = event.data;
    // this.log('got message', task);

    const source: MessageEventSource = event.source || event.currentTarget as any; // can have no source
    if(task.type === 'batch') {
      const newEvent: MessageEvent = {data: event.data, source: event.source, currentTarget: event.currentTarget} as any;
      task.payload.forEach((task) => {
        // @ts-ignore
        newEvent.data = task;
        this.onMessage(newEvent);
      });
    } else if(task.type === 'result') {
      this.processResultTask(task);
    } else if(task.type === 'ack') {
      this.processAckTask(task);
    } else if(task.type === 'invoke') {
      this.processInvokeTask(task, source, event);
    } else if(task.type === 'ping') {
      this.processPingTask(task, source, event);
    } else if(task.type === 'pong') {
      this.processPongTask(task, source, event);
    }
  };

  protected async releasePending() {
    //return;

    if(!this.listenPorts.length || this.releasingPending) {
      return;
    }

    this.releasingPending = true;
    // const perf = performance.now();
    await pause(0);

    this.debug && this.log.debug('releasing tasks, length:', this.pending.size/* , performance.now() - perf */);

    this.pending.forEach((portTasks, port) => {
      let batchTask: BatchTask;
      const tasks: Task[] = [];
      portTasks.forEach((task) => {
        if(task.transfer) {
          batchTask = undefined;
          tasks.push(task);
        } else {
          if(!batchTask) {
            batchTask = this.createTask('batch', []);
            tasks.push(batchTask);
          }

          batchTask.payload.push(task);
        }
      });

      // const tasks = portTasks;

      tasks.forEach((task) => {
        // if(task.type === 'batch') {
        //   this.log(`batching ${task.payload.length} tasks`);
        // }

        try {
          if(IS_SERVICE_WORKER) {
            notifyAll(task);
          } else {
            this.postMessage(port, task);
          }
        } catch(err) {
          this.log.error('postMessage error:', err, task, port);
        }
      });
    });

    this.debug && this.log.debug('released tasks');
    this.pending.clear();

    this.releasingPending = false;
  }

  protected processResultTask(task: ResultTask) {
    const {taskId, result, error} = task.payload;
    const deferred = this.awaiting[taskId];
    if(!deferred) {
      return;
    }

    this.debug && this.log.debug('done', deferred.taskType, result, error);
    error ? deferred.reject(error) : deferred.resolve(result);
    delete this.awaiting[taskId];
  }

  protected processAckTask(task: AckTask) {
    const payload = task.payload;
    const deferred = this.awaiting[payload.taskId];
    if(!deferred) {
      return;
    }

    // * will finish the init promise with incoming result
    const previousResolve: (acked: AckedResult<any>) => void = deferred.resolve;
    // const previousReject = deferred.reject;

    // if(payload.cached) {
    //   if('result' in payload) {
    //     previousResolve({
    //       cached: true,
    //       result: payload.result
    //     });
    //   } else {
    //     previousReject(payload.error);
    //   }
    // } else {
    //   const ret: AckedResult<any> = {
    //     cached: false,
    //     result: new Promise((resolve, reject) => {
    //       deferred.resolve = resolve;
    //       deferred.reject = reject;
    //     })
    //   };

    //   previousResolve(ret);
    // }

    const ret: AckedResult<any> = {
      cached: payload.cached,
      result: payload.cached ? ('result' in payload ? Promise.resolve(payload.result) : Promise.reject(payload.error)) : new Promise((resolve, reject) => {
        deferred.resolve = resolve;
        deferred.reject = reject;
      })
    };

    previousResolve(ret);
  }

  protected processPingTask(task: PingTask, source: MessageEventSource, event: MessageEvent) {
    this.pushTask(this.createTask('pong', undefined), event.source);
  }

  protected processPongTask(task: PongTask, source: MessageEventSource, event: MessageEvent) {
    const pingResolve = this.pingResolves.get(source);
    if(pingResolve) {
      this.pingResolves.delete(source);
      pingResolve();
    }
  }

  protected async processInvokeTask(task: InvokeTask, source: MessageEventSource, event: MessageEvent) {
    const id = task.id;
    const innerTask = task.payload;
    
    let resultTaskPayload: ResultTask['payload'];
    let resultTask: ResultTask, ackTask: AckTask;
    if(!innerTask.void) {
      resultTaskPayload = {taskId: id};
      resultTask = this.createTask('result', resultTaskPayload);
    }

    if(innerTask.withAck) {
      ackTask = this.createTask('ack', {
        taskId: id,
        cached: true
      });
    }

    let isPromise: boolean;
    try {
      const listeners = this.listeners[innerTask.type];
      if(!listeners?.length) {
        throw new Error('no listener');
      }

      const listener = listeners[0];

      // @ts-ignore
      let result = this.invokeListenerCallback(innerTask.type, listener, innerTask.payload, source, event);
      if(innerTask.void) {
        return;
      }

      isPromise = result instanceof Promise;

      if(ackTask) {
        const cached = !isPromise;
        ackTask.payload.cached = cached;
        if(cached) ackTask.payload.result = result;
        this.pushTask(ackTask, source);

        if(cached) {
          return;
        }
      }

      if(isPromise) {
        result = await result;
      }
  
      resultTaskPayload.result = result;
    } catch(error) {
      this.log.error('worker task error:', error, task);
      if(innerTask.void) {
        return;
      }

      if(ackTask && ackTask.payload.cached) {
        ackTask.payload.error = error;
        this.pushTask(ackTask, source);
        return;
      }

      resultTaskPayload.error = error;
    }

    this.pushTask(resultTask, source);
  }

  protected createTask<T extends Task['type'], K extends Task = Parameters<TaskMap[T]>[0]>(type: T, payload: K['payload'], transfer?: Transferable[]): K {
    return {
      type,
      payload,
      id: this.taskId++,
      transfer
    } as K;
  }

  protected createInvokeTask(type: string, payload: any, withAck?: boolean, _void?: boolean, transfer?: Transferable[]): InvokeTask {
    return this.createTask('invoke', {
      type,
      payload,
      withAck,
      void: _void
    }, transfer);
  }

  protected pushTask(task: Task, port?: SendPort) {
    let tasks = this.pending.get(port);
    if(!tasks) {
      this.pending.set(port, tasks = []);
    }

    tasks.push(task);
    this.releasePending();
  }

  public invokeVoid<T extends keyof Send>(type: T, payload: Parameters<Send[T]>[0], port?: SendPort, transfer?: Transferable[]) {
    const task = this.createInvokeTask(type as string, payload, undefined, true, transfer);
    this.pushTask(task, port);
  }

  public invoke<T extends keyof Send>(type: T, payload: Parameters<Send[T]>[0], withAck?: false, port?: SendPort, transfer?: Transferable[]): Promise<Awaited<ReturnType<Send[T]>>>;
  public invoke<T extends keyof Send>(type: T, payload: Parameters<Send[T]>[0], withAck?: true, port?: SendPort, transfer?: Transferable[]): Promise<AckedResult<Awaited<ReturnType<Send[T]>>>>;
  public invoke<T extends keyof Send>(type: T, payload: Parameters<Send[T]>[0], withAck?: boolean, port?: SendPort, transfer?: Transferable[]) {
    this.debug && this.log.debug('start', type, payload);

    let task: InvokeTask;
    const promise = new Promise<Awaited<ReturnType<Send[T]>>>((resolve, reject) => {
      task = this.createInvokeTask(type as string, payload, withAck, undefined, transfer);
      this.awaiting[task.id] = {resolve, reject, taskType: type as string};
      this.pushTask(task, port);
    });

    if(IS_WORKER) {
      promise.finally(() => {
        clearInterval(interval);
      });
  
      const interval = ctx.setInterval(() => {
        this.log.error('task still has no result', task, port);
      }, 5e3);
    } else if(false) {
      // let timedOut = false;
      const startTime = Date.now();
      promise.finally(() => {
        const elapsedTime = Date.now() - startTime;
        if(elapsedTime >= TIMEOUT) {
          this.log.error(`task was processing ${Date.now() - startTime}ms`, task.payload.payload, port);
        }/*  else {
          clearTimeout(timeout);
        } */
      });

      const TIMEOUT = 10;
      // const timeout = ctx.setTimeout(() => {
      //   timedOut = true;
      //   // this.log.error(`task is processing more than ${TIMEOUT} milliseconds`, task, port);
      // }, TIMEOUT);
    }

    return promise;
  }

  public invokeExceptSource<T extends keyof Send>(type: T, payload: Parameters<Send[T]>[0], source?: SendPort) {
    const ports = this.sendPorts.slice();
    indexOfAndSplice(ports, source);

    ports.forEach((target) => {
      this.invokeVoid(type, payload, target);
    });
  }
}