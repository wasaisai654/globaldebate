const express = require('express');
const cors = require('cors');
const serverless = require('serverless-http');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const http = require('http');
const socketIo = require('socket.io');

// 数据库模块
const db = require('./db');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Supabase 客户端
let supabase = null;

// 初始化 Supabase 客户端
try {
  const supabaseUrl = process.env.SUPABASE_URL || 'https://rmfwcjjgtemfhswomkoh.supabase.co';
  const supabaseKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_8MZXHrhYYjs8ZnFqU1aA9g_-h4TRjJa';
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase 配置缺失：请设置 SUPABASE_URL 和 SUPABASE_ANON_KEY 环境变量');
  } else {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('Supabase 客户端初始化成功');
  }
} catch (error) {
  console.error('Supabase 客户端初始化失败:', error);
}

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件服务
app.use(express.static(path.join(__dirname, '..')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Multer 文件上传配置
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../uploads'));
  },
  filename: function (req, file, cb) {
    const uniqueName = uuidv4() + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: process.env.MAX_FILE_SIZE ? parseInt(process.env.MAX_FILE_SIZE) : 100 * 1024 }, // 默认100kB
  fileFilter: function (req, file, cb) {
    // 允许所有文件类型
    cb(null, true);
  }
});

// 中间件：记录访问统计
app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';
  db.logAccess(req.path, ip, userAgent);
  next();
});

// API 路由

// 测试API
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Global Debate Hub API is running!',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// 获取网站统计
app.get('/api/stats', (req, res) => {
  db.getSiteStats((err, stats) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to get stats' });
    }

    // 获取最新发言
    db.getLatestSpeeches(5, (err, speeches) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to get speeches' });
      }

      res.json({
        siteStats: stats,
        latestSpeeches: speeches
      });
    });
  });
});

// 获取资源列表
app.get('/api/resources', (req, res) => {
  const { category, limit = 50 } = req.query;
  
  let query = 'SELECT * FROM resources ORDER BY upload_time DESC LIMIT ?';
  let params = [parseInt(limit)];
  
  if (category) {
    query = 'SELECT * FROM resources WHERE category = ? ORDER BY upload_time DESC LIMIT ?';
    params = [category, parseInt(limit)];
  }
  
  db.db.all(query, params, (err, resources) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to get resources' });
    }
    
    res.json(resources);
  });
});

// 上传资源（前端直接上传到Supabase，后端只保存元数据）
app.post('/api/resources', upload.single('file'), (req, res) => {
  const { filename, originalname, mimetype, size, category, description, uploader, storage_path, public_url } = req.body;
  
  if (!filename || !originalname) {
    return res.status(400).json({ error: 'Filename and originalname are required' });
  }
  
  const id = uuidv4();
  const uploadTime = moment().format('YYYY-MM-DD HH:mm:ss');
  
  db.db.run(
    'INSERT INTO resources (id, filename, originalname, mimetype, size, category, description, uploader, upload_time, storage_path, public_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, filename, originalname, mimetype, size, category, description, uploader, uploadTime, storage_path, public_url],
    function(err) {
      if (err) {
        console.error('Error saving resource metadata:', err);
        return res.status(500).json({ error: 'Failed to save resource metadata' });
      }
      
      res.json({
        success: true,
        message: 'Resource metadata saved successfully',
        resourceId: id
      });
    }
  );
});

// 下载资源（重定向到Supabase公共URL）
app.get('/api/resources/:id/download', (req, res) => {
  const { id } = req.params;

  // 从数据库获取资源信息
  db.db.get('SELECT * FROM resources WHERE id = ?', [id], (err, resource) => {
    if (err || !resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    // 检查是否有公共 URL
    if (resource.public_url) {
      // 更新下载次数
      db.incrementDownloadCount(id, (err) => {
        if (err) {
          console.error('Error updating download count:', err);
        }
      });

      // 重定向到 Supabase 公共 URL
      return res.redirect(resource.public_url);
    }

    // 如果没有公共 URL，检查是否有存储路径
    if (resource.storage_path) {
      // 尝试生成公共 URL
      try {
        const { data: urlData } = supabase.storage
          .from('user-uploads')
          .getPublicUrl(resource.storage_path);

        if (urlData.publicUrl) {
          // 更新下载次数
          db.incrementDownloadCount(id, (err) => {
            if (err) {
              console.error('Error updating download count:', err);
            }
          });

          // 重定向到生成的公共 URL
          return res.redirect(urlData.publicUrl);
        }
      } catch (error) {
        console.error('生成公共 URL 失败:', error);
      }
    }

    // 如果都没有，返回错误
    return res.status(404).json({
      error: 'File not available for download',
      message: 'The requested file is not available in storage'
    });
  });
});

// 获取最新发言
app.get('/api/speeches', (req, res) => {
  const { limit = 10 } = req.query;

  db.getLatestSpeeches(parseInt(limit), (err, speeches) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to get speeches' });
    }
    
    res.json(speeches);
  });
});

// 添加新发言
app.post('/api/speeches', (req, res) => {
  const { speaker, content, debateTopic, duration } = req.body;

  if (!speaker || !content) {
    return res.status(400).json({ error: 'Speaker and content are required' });
  }

  db.addSpeech(speaker, content, debateTopic || 'General Debate', duration || 60, (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to add speech' });
    }

    // 广播新发言给所有连接的客户端
    io.emit('new_speech', {
      id: result.id,
      speaker,
      content,
      debateTopic: debateTopic || 'General Debate',
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Speech added successfully',
      speechId: result.id
    });
  });
});

// 获取计时器状态
app.get('/api/timer', (req, res) => {
  db.getTimerState((err, timerState) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to get timer state' });
    }
    
    res.json(timerState || { isRunning: false, remainingTime: 0, currentSpeaker: '' });
  });
});

// 获取当前服务器时间
app.get('/api/time', (req, res) => {
  res.json({
    serverTime: new Date().toISOString(),
    timestamp: Date.now()
  });
});

// 默认路由 - 返回前端页面
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// Socket.IO 连接处理
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // 处理开始计时
  socket.on('start_timer', (data) => {
    const { speaker, duration } = data;
    
    db.startTimer(speaker, duration, (err) => {
      if (err) {
        console.error('Error starting timer:', err);
        return;
      }
      
      // 广播计时器开始给所有客户端
      io.emit('timer_started', {
        speaker,
        duration,
        startTime: new Date().toISOString()
      });
    });
  });

  // 处理停止计时
  socket.on('stop_timer', () => {
    db.stopTimer((err) => {
      if (err) {
        console.error('Error stopping timer:', err);
        return;
      }
      
      // 广播计时器停止给所有客户端
      io.emit('timer_stopped');
    });
  });

  // 处理新发言
  socket.on('new_speech', (data) => {
    const { speaker, content, debateTopic, duration } = data;
    
    db.addSpeech(speaker, content, debateTopic || 'General Debate', duration || 60, (err, result) => {
      if (err) {
        console.error('Error adding speech:', err);
        return;
      }
      
      // 广播新发言给所有客户端
      io.emit('new_speech', {
        id: result.id,
        speaker,
        content,
        debateTopic: debateTopic || 'General Debate',
        timestamp: new Date().toISOString()
      });
    });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Global Debate Hub server running on port ${PORT}`);
  console.log(`Access the application at http://localhost:${PORT}`);
});

// 导出给Vercel使用
module.exports.handler = serverless(app);
