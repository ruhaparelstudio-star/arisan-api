import { Hono } from 'hono';
import { healthRoute } from './routes/health';
import { authRoute } from './routes/auth';
import { usersRoute } from './routes/users';
import { groupsRoute } from './routes/groups';
import { paymentsRoute } from './routes/payments';
import { undianRoute } from './routes/undian';
import { swapsRoute } from './routes/swaps';
import { notificationsRoute } from './routes/notifications';
import { cronRoute } from './routes/cron';
import { adminRoute } from './routes/admin';

const app = new Hono();

app.route('/health', healthRoute);
app.route('/api/auth', authRoute);
app.route('/api/users', usersRoute);
app.route('/api/groups', groupsRoute);
app.route('/api/payments', paymentsRoute);
app.route('/api/groups', undianRoute);
app.route('/api/swaps', swapsRoute);
app.route('/api/notifications', notificationsRoute);
app.route('/api/cron', cronRoute);
app.route('/admin', adminRoute);

export default app;
