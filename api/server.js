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
        latestSpeeches: speeches,
        currentTime: new Date().toISOString(),
        serverTime: moment().format('YYYY-MM-DD HH:mm:ss')
      });
    });
  });
});

// 获取资源列表
app.get('/api/resources', (req, res) => {
  const { category = 'all', sort = 'newest' } = req.query;
  
  db.getResources(category, sort, (err, resources) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to get resources' });
    }
    res.json(resources);
  });
});

// 上传资源（前端直接上传到 Supabase，后端只保存元数据）
app.post('/api/resources', async (req, res) => {
  try {
    const { 
      filename, 
      originalname, 
      mimetype, 
      size, 
      category = 'other', 
      description = '', 
      uploader = 'Anonymous',
      storage_path,
      public_url
    } = req.body;
    
    // 验证必要字段
    if (!filename || !originalname || !mimetype || size === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields: filename, originalname, mimetype, size are required' 
      });
    }
    
    // 生成资源数据
    const resourceData = {
      id: uuidv4(),
      filename: filename,
      originalname: originalname,
      mimetype: mimetype,
      size: size,
      category: category,
      description: description,
      uploader: uploader,
      storage_path: storage_path || filename,
      public_url: public_url || '',
      upload_time: new Date().toISOString()
    };
    
    // 保存到数据库
    db.addResource(resourceData, (err, result) => {
      if (err) {
        console.error('数据库保存错误:', err);
        return res.status(500).json({ error: 'Failed to save resource info to database' });
      }
      
      console.log('资源元数据保存成功:', resourceData.id);
      
      res.json({
        success: true,
        message: 'Resource metadata saved successfully',
        resource: resourceData,
        downloadUrl: `/api/resources/${resourceData.id}/download`,
        publicUrl: public_url || ''
      });
    });
  } catch (error) {
    console.error('上传资源错误:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 下载资源（重定向到 Supabase 公共 URL）
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

// 提交新发言
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
    res.json(timerState);
  });
});

// 更新计时器状态
app.post('/api/timer', (req, res) => {
  const { is_running, remaining_time, total_time, current_speaker } = req.body;
  
  const timerState = {
    is_running: is_running || false,
    remaining_time: remaining_time || 300,
    total_time: total_time || 300,
    current_speaker: current_speaker || ''
  };
  
  db.updateTimerState(timerState, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to update timer state' });
    }
    
    // 广播计时器更新给所有连接的客户端
    io.emit('timer_update', timerState);
    
    res.json({
      success: true,
      message: 'Timer updated successfully',
      timer: timerState
    });
  });
});

// 重置计时器
app.post('/api/timer/reset', (req, res) => {
  const { total_time = 300 } = req.body;
  
  const timerState = {
    is_running: false,
    remaining_time: total_time,
    total_time: total_time,
    current_speaker: ''
  };
  
  db.updateTimerState(timerState, (err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to reset timer' });
    }
    
    io.emit('timer_reset', timerState);
    
    res.json({
      success: true,
      message: 'Timer reset successfully',
      timer: timerState
    });
  });
});

// 获取当前服务器时间
app.get('/api/time', (req, res) => {
  res.json({
    iso: new Date().toISOString(),
    formatted: moment().format('YYYY-MM-DD HH:mm:ss'),
    timestamp: Date.now(),
    timezone: 'UTC'
  });
});

// 默认路由 - 返回前端页面
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// Socket.IO 连接处理
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // 发送当前计时器状态给新连接的客户端
  db.getTimerState((err, timerState) => {
    if (!err && timerState) {
      socket.emit('timer_state', timerState);
    }
  });
  
  // 发送最新发言给新连接的客户端
  db.getLatestSpeeches(10, (err, speeches) => {
    if (!err && speeches) {
      socket.emit('latest_speeches', speeches);
    }
  });
  
  // 处理计时器控制
  socket.on('timer_control', (data) => {
    const { action, value } = data;
    
    db.getTimerState((err, timerState) => {
      if (err) return;
      
      let newState = { ...timerState };
      
      switch (action) {
        case 'start':
          newState.is_running = true;
          break;
        case 'pause':
          newState.is_running = false;
          break;
        case 'reset':
          newState.is_running = false;
          newState.remaining_time = newState.total_time;
          newState.current_speaker = '';
          break;
        case 'set_time':
          if (value) {
            newState.total_time = value;
            if (!newState.is_running) {
              newState.remaining_time = value;
            }
          }
          break;
        case 'set_speaker':
          newState.current_speaker = value || '';
          break;
        case 'tick':
          if (newState.is_running && newState.remaining_time > 0) {
            newState.remaining_time -= 1;
          }
          break;
      }
      
      db.updateTimerState(newState, (err) => {
        if (!err) {
          io.emit('timer_update', newState);
        }
      });
    });
  });
  
  // 处理新发言
  socket.on('new_speech', (speechData) => {
    const { speaker, content, debateTopic, duration } = speechData;
    
    if (speaker && content) {
      db.addSpeech(speaker, content, debateTopic, duration, (err, result) => {
        if (!err) {
          const newSpeech = {
            id: result.id,
            speaker,
            content,
            debate_topic: debateTopic || 'General Debate',
            speech_time: new Date().toISOString(),
            duration: duration || 60
          };
          
          io.emit('new_speech', newSpeech);
        }
      });
    }
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
