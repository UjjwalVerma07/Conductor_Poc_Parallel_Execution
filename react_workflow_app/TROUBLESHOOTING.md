# Troubleshooting Guide

## Network Error: Cannot Connect to Conductor

If you see a **"Network Error"** when clicking the Deploy button, this is typically caused by one of these issues:

### 1. Conductor Server Not Running ❌

**Check if Conductor is running:**

```bash
# Check if Conductor is accessible
curl http://localhost:8080/api/health

# Or check the specific port
netstat -an | grep 8080
```

**Solution:**
- Start your Conductor server
- Verify it's running on the correct port (default: 8080)

### 2. CORS (Cross-Origin Resource Sharing) Not Enabled 🚫

This is the **most common issue**. When the React app (running on `localhost:5173`) tries to connect to Conductor (running on `localhost:8080`), the browser blocks the request due to CORS policy.

#### Fix #1: Enable CORS in Conductor Server Config

Add these properties to your `config.properties` file (usually in `server-config/config.properties`):

```properties
# Enable CORS
conductor.grpc-server.enabled=false
spring.jackson.serialization.write-dates-as-timestamps=false

# For Conductor 3.x+, enable event processing
conductor.default-event-processor.enabled=true
```

Then restart Conductor.

#### Fix #2: Use Docker Compose with CORS Headers

If running Conductor in Docker, add CORS headers to the nginx or conductor container:

**docker-compose.yml example:**

```yaml
conductor-server:
  image: conductor:server
  environment:
    - CONFIG_PROP=config.properties
  ports:
    - "8080:8080"
  command: >
    sh -c "java -jar conductor-server.jar"
  # Add CORS proxy
  labels:
    - "traefik.enable=true"
    - "traefik.http.middlewares.cors.headers.accesscontrolallowmethods=GET,POST,PUT,DELETE,OPTIONS"
    - "traefik.http.middlewares.cors.headers.accesscontrolalloworigin=*"
```

#### Fix #3: Run React App Through Proxy

Update `vite.config.ts` to proxy requests to Conductor:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      }
    }
  }
})
```

Then change the Conductor URL in the app to use relative paths:
- Instead of: `http://localhost:8080`
- Use: `http://localhost:5173` (or just empty string)

#### Fix #4: Use Browser Extension (Development Only)

Install a CORS browser extension like:
- **Chrome/Edge**: "CORS Unblock" or "Allow CORS"
- **Firefox**: "CORS Everywhere"

⚠️ **Warning**: This is only for development. Don't use in production.

### 3. Wrong Conductor URL 🔗

**Common mistakes:**
- ❌ `http://localhost:8080/` (trailing slash)
- ❌ `localhost:8080` (missing http://)
- ❌ Wrong port number

**Correct format:**
- ✅ `http://localhost:8080`
- ✅ `http://conductor-server:8080` (if in Docker network)
- ✅ `http://192.168.1.100:8080` (for remote servers)

**Use the "Test Connection" button** in the Deploy dialog to verify your URL is correct.

### 4. Firewall Blocking Connection 🔥

Check if your firewall is blocking the port:

**Windows:**
```powershell
# Check if port 8080 is open
Test-NetConnection -ComputerName localhost -Port 8080
```

**Linux/Mac:**
```bash
# Check if port 8080 is open
nc -zv localhost 8080
```

**Solution:**
- Add firewall exception for port 8080
- Or temporarily disable firewall for testing

### 5. Network Timeout ⏱️

If Conductor is slow to respond, you might get a timeout error.

**Solution:**
- Check Conductor server logs for performance issues
- Increase timeout in `conductorApi.ts` (currently set to 10 seconds)

```typescript
const axiosInstance = axios.create({
  timeout: 30000, // Increase to 30 seconds
});
```

## Quick Diagnosis

### Step 1: Test Connection Button

1. Open the Designer UI
2. Click **"Deploy"** button
3. Enter Conductor URL: `http://localhost:8080`
4. Click **"Test Connection"** button

**If successful:** You'll see "Connected to Conductor successfully" ✅

**If failed:** Read the error message for specific issue

### Step 2: Check Conductor Health Directly

Open in browser: `http://localhost:8080/api/health`

**Expected response:**
```json
{
  "status": "UP",
  "healthy": true
}
```

If you see this, Conductor is running but CORS is the issue.

### Step 3: Check Browser Console

1. Open browser DevTools (F12)
2. Go to **Console** tab
3. Try deploying again
4. Look for error messages

**Common errors:**

```
Access to XMLHttpRequest at 'http://localhost:8080/api/metadata/workflow' 
from origin 'http://localhost:5173' has been blocked by CORS policy
```
→ **Fix**: Enable CORS on Conductor (see Fix #1 or #2 above)

```
net::ERR_CONNECTION_REFUSED
```
→ **Fix**: Conductor server is not running

```
net::ERR_NAME_NOT_RESOLVED
```
→ **Fix**: Wrong hostname/URL

## Working Configuration Example

### Docker Compose Setup

```yaml
version: '3'

services:
  conductor-server:
    image: conductor:server
    ports:
      - "8080:8080"
    environment:
      - SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/conductor
    volumes:
      - ./server-config/config.properties:/app/config/config.properties

  reactflow-designer:
    build: ./reactflow-workflow-designer
    ports:
      - "5173:80"
    environment:
      - VITE_CONDUCTOR_URL=http://conductor-server:8080
```

### With Nginx Reverse Proxy

```nginx
server {
    listen 80;
    
    # Serve React app
    location / {
        root /usr/share/nginx/html;
        try_files $uri /index.html;
    }
    
    # Proxy API calls to Conductor
    location /api/ {
        proxy_pass http://conductor-server:8080/api/;
        proxy_set_header Host $host;
        
        # Enable CORS
        add_header 'Access-Control-Allow-Origin' '*';
        add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS';
        add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization';
        
        if ($request_method = 'OPTIONS') {
            return 204;
        }
    }
}
```

## Still Having Issues?

### Check Logs

**Conductor Server Logs:**
```bash
docker logs conductor-server
# or
tail -f /path/to/conductor/logs/conductor.log
```

**Browser Network Tab:**
1. Open DevTools (F12)
2. Go to **Network** tab
3. Try deploying
4. Click on the failed request
5. Check **Response** tab for error details

### Common Error Messages

| Error Message | Cause | Solution |
|--------------|-------|----------|
| "Network Error - CORS may need to be enabled" | CORS not configured | Enable CORS on Conductor |
| "Connection timeout" | Conductor not responding | Check if Conductor is running |
| "Workflow already exists" | Duplicate workflow | Increment version or delete old workflow |
| "Failed to deploy workflow: 400" | Invalid workflow JSON | Check JSON structure in "View JSON" |
| "Failed to deploy workflow: 500" | Conductor server error | Check Conductor logs |

## Recommended Setup for Development

1. **Run Conductor with Docker** - Easier to configure CORS
2. **Use nginx reverse proxy** - Handles CORS automatically
3. **Or use Vite proxy config** - Simplest for development

**Vite Proxy Setup (Recommended):**

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:8080'
    }
  }
})
```

Then use empty string or `http://localhost:5173` as Conductor URL in the app.

## Need More Help?

- Check Conductor documentation: https://conductor-oss.github.io/conductor/
- Review browser console for detailed errors
- Check Conductor server logs
- Verify network connectivity with `curl` or `wget`

---

**Last Updated:** November 2025




