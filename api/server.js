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

// 鏁版嵁搴撴ā鍧?const db = require('./db');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Supabase 瀹㈡埛绔?let supabase = null;

// 鍒濆鍖?Supabase 瀹㈡埛绔?try {
  const supabaseUrl = process.env.SUPABASE_URL || 'https://rmfwcjjgtemfhswomkoh.supabase.co';
  const supabaseKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_8MZXHrhYYjs8ZnFqU1aA9g_-h4TRjJa';
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase 閰嶇疆缂哄け锛氳璁剧疆 SUPABASE_URL 鍜?SUPABASE_ANON_KEY 鐜鍙橀噺');
  } else {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('Supabase 瀹㈡埛绔垵濮嬪寲鎴愬姛');
  }
} catch (error) {
  console.error('Supabase 瀹㈡埛绔垵濮嬪寲澶辫触:', error);
}

// 涓棿浠?app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 闈欐€佹枃浠舵湇鍔?app.use(express.static(path.join(__dirname, '..')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Multer 鏂囦欢涓婁紶閰嶇疆
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
  limits: { fileSize: process.env.MAX_FILE_SIZE ? parseInt(process.env.MAX_FILE_SIZE) : 100 * 1024 }, // 榛樿100kB
  fileFilter: function (req, file, cb) {
    // 鍏佽鎵€鏈夋枃浠剁被鍨?    cb(null, true);
  }
});

// 涓棿浠讹細璁板綍璁块棶缁熻
app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || '';
  db.logAccess(req.path, ip, userAgent);
  next();
});

// API 璺敱

// 娴嬭瘯API
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Global Debate Hub API is running!',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// 鑾峰彇缃戠珯缁熻
app.get('/api/stats', (req, res) => {
  db.getSiteStats((err, stats) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to get stats' });
    }
    
    // 鑾峰彇鏈€鏂板彂瑷€
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

// 鑾峰彇璧勬簮鍒楄〃
app.get('/api/resources', (req, res) => {
  const { category = 'all', sort = 'newest' } = req.query;
  
  db.getResources(category, sort, (err, resources) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to get resources' });
    }
    res.json(resources);
  });
});

// 涓婁紶璧勬簮锛堝墠绔洿鎺ヤ笂浼犲埌 Supabase锛屽悗绔彧淇濆瓨鍏冩暟鎹級
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
    
    // 楠岃瘉蹇呰瀛楁
    if (!filename || !originalname || !mimetype || size === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields: filename, originalname, mimetype, size are required' 
      });
    }
    
    // 鐢熸垚璧勬簮鏁版嵁
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
    
    // 淇濆瓨鍒版暟鎹簱
    db.addResource(resourceData, (err, result) => {
      if (err) {
        console.error('鏁版嵁搴撲繚瀛橀敊璇?', err);
        return res.status(500).json({ error: 'Failed to save resource info to database' });
      }
      
      console.log('璧勬簮鍏冩暟鎹繚瀛樻垚鍔?', resourceData.id);
      
      res.json({
        success: true,
        message: 'Resource metadata saved successfully',
        resource: resourceData,
        downloadUrl: `/api/resources/${resourceData.id}/download`,
        publicUrl: public_url || ''
      });
    });
  } catch (error) {
    console.error('涓婁紶璧勬簮閿欒:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 涓嬭浇璧勬簮锛堥噸瀹氬悜鍒?Supabase 鍏叡 URL锛?app.get('/api/resources/:id/download', (req, res) => {
  const { id } = req.params;
  
  // 浠庢暟鎹簱鑾峰彇璧勬簮淇℃伅
  db.db.get('SELECT * FROM resources WHERE id = ?', [id], (err, resource) => {
    if (err || !resource) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    
    // 妫€鏌ユ槸鍚︽湁鍏叡 URL
    if (resource.public_url) {
      // 鏇存柊涓嬭浇娆℃暟
      db.incrementDownloadCount(id, (err) => {
        if (err) {
          console.error('Error updating download count:', err);
        }
      });
      
      // 閲嶅畾鍚戝埌 Supabase 鍏叡 URL
      return res.redirect(resource.public_url);
    }
    
    // 濡傛灉娌℃湁鍏叡 URL锛屾鏌ユ槸鍚︽湁瀛樺偍璺緞
    if (resource.storage_path) {
      // 灏濊瘯鐢熸垚鍏叡 URL
      try {
        const { data: urlData } = supabase.storage
          .from('user-uploads')
          .getPublicUrl(resource.storage_path);
        
        if (urlData.publicUrl) {
          // 鏇存柊涓嬭浇娆℃暟
          db.incrementDownloadCount(id, (err) => {
            if (err) {
              console.error('Error updating download count:', err);
            }
          });
          
          // 閲嶅畾鍚戝埌鐢熸垚鐨勫叕鍏?URL
          return res.redirect(urlData.publicUrl);
        }
      } catch (error) {
        console.error('鐢熸垚鍏叡 URL 澶辫触:', error);
      }
    }
    
    // 濡傛灉閮芥病鏈夛紝杩斿洖閿欒
    return res.status(404).json({ 
      error: 'File not available for download',
      message: 'The requested file is not available in storage'
    });
  });
});

// 鑾峰彇鏈€鏂板彂瑷€
app.get('/api/speeches', (req, res) => {
  const { limit = 10 } = req.query;
  
  db.getLatestSpeeches(parseInt(limit), (err, speeches) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to get speeches' });
    }
    res.json(speeches);
  });
});

// 鎻愪氦鏂板彂瑷€
app.post('/api/speeches', (req, res) => {
  const { speaker, content, debateTopic, duration } = req.body;
  
  if (!speaker || !content) {
    return res.status(400).json({ error: 'Speaker and content are required' });
  }
  
  db.addSpeech(speaker, content, debateTopic || 'General Debate', duration || 60, (err, result) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to add speech' });
    }
    
    // 骞挎挱鏂板彂瑷€缁欐墍鏈夎繛鎺ョ殑瀹㈡埛绔?    io.emit('new_speech', {
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

// 鑾峰彇璁℃椂鍣ㄧ姸鎬?app.get('/api/timer', (req, res) => {
  db.getTimerState((err, timerState) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to get timer state' });
    }
    res.json(timerState);
  });
});

// 鏇存柊璁℃椂鍣ㄧ姸鎬?app.post('/api/timer', (req, res) => {
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
    
    // 骞挎挱璁℃椂鍣ㄦ洿鏂扮粰鎵€鏈夎繛鎺ョ殑瀹㈡埛绔?    io.emit('timer_update', timerState);
    
    res.json({
      success: true,
      message: 'Timer updated successfully',
      timer: timerState
    });
  });
});

// 閲嶇疆璁℃椂鍣?app.post('/api/timer/reset', (req, res) => {
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

// 鑾峰彇褰撳墠鏈嶅姟鍣ㄦ椂闂?app.get('/api/time', (req, res) => {
  res.json({
    iso: new Date().toISOString(),
    formatted: moment().format('YYYY-MM-DD HH:mm:ss'),
    timestamp: Date.now(),
    timezone: 'UTC'
  });
});

// 榛樿璺敱 - 杩斿洖鍓嶇椤甸潰
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../index.html'));
});

// Socket.IO 杩炴帴澶勭悊
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // 鍙戦€佸綋鍓嶈鏃跺櫒鐘舵€佺粰鏂拌繛鎺ョ殑瀹㈡埛绔?  db.getTimerState((err, timerState) => {
    if (!err && timerState) {
      socket.emit('timer_state', timerState);
    }
  });
  
  // 鍙戦€佹渶鏂板彂瑷€缁欐柊杩炴帴鐨勫鎴风
  db.getLatestSpeeches(10, (err, speeches) => {
    if (!err && speeches) {
      socket.emit('latest_speeches', speeches);
    }
  });
  
  // 澶勭悊璁℃椂鍣ㄦ帶鍒?  socket.on('timer_control', (data) => {
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
  
  // 澶勭悊鏂板彂瑷€
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

// 閿欒澶勭悊涓棿浠?app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 鍚姩鏈嶅姟鍣?const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Global Debate Hub server running on port ${PORT}`);
  console.log(`Access the application at http://localhost:${PORT}`);
});

// 瀵煎嚭缁橵ercel浣跨敤
module.exports.handler = serverless(app);

