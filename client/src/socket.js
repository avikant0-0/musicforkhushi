import { io } from "socket.io-client";

// Same-origin. In dev, Vite proxies /socket.io to the Node backend (:3000).
export const socket = io({ autoConnect: false });
