import {expect,test} from '@playwright/test';
test('dashboard and preferences work with honestly unavailable services',async({page})=>{
  await page.route('**/api/v1/**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Services are offline for this browser check'}})}));
  await page.goto('/');await expect(page.getByRole('heading',{name:'Processing, at a glance.'})).toBeVisible();await expect(page.getByText('Services unavailable',{exact:true})).toBeVisible();
  await expect(page.getByText('Your activity starts here')).toBeVisible();await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByLabel('Default quality').fill('77');await page.getByRole('button',{name:'Save preferences'}).click();await page.reload();await expect(page.getByLabel('Default quality')).toHaveValue('77');
  await page.getByRole('link',{name:'Architecture',exact:true}).click();await page.getByRole('button',{name:/05 Worker/}).click();await expect(page.getByRole('heading',{name:'Worker',exact:true})).toBeVisible();
});
test('mobile navigation and image controls are accessible',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.route('**/api/v1/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":{"message":"Offline"}}'}));
  await page.goto('/process');await expect(page.getByRole('heading',{name:'Great images. Less effort.'})).toBeVisible();await expect(page.getByRole('button',{name:'Browse files'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.getByRole('button',{name:'Open navigation'}).click();await page.getByRole('link',{name:'Job History',exact:true}).click();await expect(page.getByRole('heading',{name:'Your job history.'})).toBeVisible();
});
test('live upload → queue → Python transform → private result',async({page,request})=>{
  test.skip(process.env.LIVE_E2E!=='1','Requires actual PostgreSQL, Redis, MinIO, API and BullMQ/Python worker');
  await page.goto('/process');await page.getByRole('button',{name:/Try a generated demo image/}).click();await expect(page.locator('.upload-item')).toHaveCount(1);await page.getByLabel('Width',{exact:true}).fill('480');await page.getByRole('button',{name:'Process 1 image',exact:true}).click();await expect(page.locator('.job-detail .badge')).toHaveText('completed',{timeout:90000});
  await expect(page.getByAltText('Processed image')).toHaveJSProperty('naturalWidth',480);const id=await page.locator('.job-detail .mono').textContent();const signed=await request.get(`/api/v1/jobs/${id}/download`);expect(signed.status()).toBe(200);const {url}=await signed.json();const result=await request.get(url);expect(result.status()).toBe(200);expect(result.headers()['content-type']).toContain('image/webp');
  await page.screenshot({path:'docs/screenshots/completed-job.png',fullPage:true});
  await page.goto('/');await expect(page.locator('.metric-card').nth(1).locator('strong')).not.toHaveText('—');await page.screenshot({path:'docs/screenshots/dashboard.png',fullPage:true});
  await page.goto('/api/v1/docs/');await expect(page.locator('.swagger-ui .info .title')).toContainText('CloudFrame Image Processing API');
});
test('live multi-file batch produces real PNG grayscale thumbnails',async({page,request})=>{
  test.skip(process.env.LIVE_E2E!=='1','Requires the actual distributed processing stack');
  await page.goto('/process');
  await page.getByLabel('Upload images',{exact:true}).setInputFiles(['tests/fixtures/demo-landscape.jpeg','tests/fixtures/demo-landscape.webp']);
  await expect(page.locator('.upload-item')).toHaveCount(2);
  await page.getByRole('button',{name:'PNG',exact:true}).click();
  await page.getByLabel('Rotation',{exact:true}).selectOption('90');
  await page.getByLabel('Grayscale',{exact:true}).check();
  await page.getByLabel('320px thumbnail',{exact:true}).check();
  await page.getByRole('button',{name:'Process 2 images',exact:true}).click();
  await expect(page.locator('.job-detail .badge')).toHaveText(['completed','completed'],{timeout:90000});
  for(const details of await page.locator('.job-detail').all()){
    await expect(details.getByAltText('Processed image')).toHaveJSProperty('naturalWidth',200);
    const id=await details.locator('.mono').textContent();const signed=await request.get(`/api/v1/jobs/${id}/download`);expect(signed.ok()).toBe(true);const {url}=await signed.json();const output=await request.get(url);expect(output.headers()['content-type']).toContain('image/png');
  }
  await page.getByRole('link',{name:'Monitoring',exact:true}).click();
  await expect(page.locator('.service-row .badge')).toHaveText(['completed','completed','completed']);
});
