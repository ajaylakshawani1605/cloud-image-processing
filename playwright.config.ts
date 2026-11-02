import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/e2e',timeout:120000,workers:1,use:{baseURL:process.env.BASE_URL||'http://localhost:5173',headless:true,screenshot:'only-on-failure'},webServer:process.env.BASE_URL?undefined:{command:'npm run dev -w frontend',url:'http://localhost:5173',reuseExistingServer:true,timeout:60000},reporter:'list'});
