// Global Debate Hub - Frontend JavaScript
// Main application controller

class GlobalDebateHub {
    async constructor() {
        this.socket = null;
        this.currentUser = null;
        this.timerInterval = null;
        this.currentTimerState = null;
        this.visitsChart = null;
        this.supabase = null;
        toastr.options = {
            "closeButton": true,
            "debug": false,
            "newestOnTop": true,
            "progressBar": true,
            "positionClass": "toast-top-right",
            "preventDuplicates": false,
            "onclick": null,
            "showDuration": "300",
            "hideDuration": "1000",
            "timeOut": "5000",
            "extendedTimeOut": "1000",
            "showEasing": "swing",
            "hideEasing": "linear",
            "showMethod": "fadeIn",
            "hideMethod": "fadeOut"
        };

        // Check for existing user session
        this.checkAuth();
        
        // Initialize Supabase client
        this.initSupabase();

        // Load initial data
        await this.loadStats();
        await this.loadLatestSpeeches();
        await this.loadResources();
        await this.loadTimerState();
        
        // Start time display
        this.updateTimeDisplay();
        setInterval(() => this.updateTimeDisplay(), 1000);
        
        // Bind events
        this.bindEvents();
        
        // Show welcome message
        setTimeout(() => {
            toastr.info('Welcome to Global Debate Hub!');
        }, 1000);
    }

    // Authentication methods
    checkAuth() {
        const username = localStorage.getItem('debateHubUsername');
        if (username) {
            this.currentUser = username;
            this.updateAuthUI();
        }
    }

    updateAuthUI() {
        const loginBtn = document.getElementById('loginBtn');
        const userInfo = document.getElementById('userInfo');
        const usernameSpan = document.getElementById('username');
        
        if (this.currentUser) {
            loginBtn.style.display = 'none';
            userInfo.style.display = 'flex';
            usernameSpan.textContent = this.currentUser;
        } else {
            loginBtn.style.display = 'inline-flex';
            userInfo.style.display = 'none';
        }
    }

    login(username) {
        if (!username.trim()) {
            toastr.error('Please enter a username');
            return false;
        }
        
        this.currentUser = username.trim();
        localStorage.setItem('debateHubUsername', this.currentUser);
        this.updateAuthUI();
        toastr.success(`Welcome, ${this.currentUser}!`);
        this.closeModal('authModal');
        return true;
    }

    logout() {
        this.currentUser = null;
        localStorage.removeItem('debateHubUsername');
        this.updateAuthUI();
        toastr.info('You have been logged out');
    }

    // Socket.IO methods
    initSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to server via Socket.IO');
        });
        
        this.socket.on('timer_update', (state) => {
            this.currentTimerState = state;
            this.updateTimerDisplay();
        });
        
        this.socket.on('timer_reset', (state) => {
            this.currentTimerState = state;
            this.updateTimerDisplay();
            toastr.info('Timer has been reset');
        });
        
        this.socket.on('new_speech', (speech) => {
            this.addSpeechToUI(speech);
            toastr.info(`New speech by ${speech.speaker}`);
        });
        
        this.socket.on('latest_speeches', (speeches) => {
            this.displaySpeeches(speeches);
        });
        
        this.socket.on('timer_state', (state) => {
            this.currentTimerState = state;
            this.updateTimerDisplay();
        });
    }

    // API methods
    async fetchAPI(endpoint, options = {}) {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
            },
        };
        
        const config = { ...defaultOptions, ...options };
        
        try {
            const response = await fetch(`/api${endpoint}`, config);
            
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            toastr.error('Failed to connect to server');
            throw error;
        }
    }

    async loadStats() {
        try {
            const data = await this.fetchAPI('/stats');
            
            // Update visit counts
            document.getElementById('totalVisits').textContent = 
                data.siteStats?.total_visits || 0;
            document.getElementById('todayVisits').textContent = 
                data.siteStats?.today_visits || 0;
            document.getElementById('pageViews').textContent = 
                data.siteStats?.total_visits || 0;
            document.getElementById('todayPageViews').textContent = 
                data.siteStats?.today_visits || 0;
            
            // Update speech count
            document.getElementById('speechCount').textContent = 
                data.latestSpeeches?.length || 0;
            
            // Update server time
            document.getElementById('serverTime').textContent = 
                `Server Time: ${data.serverTime}`;
                
        } catch (error) {
            console.error('Failed to load stats:', error);
        }
    }

    async loadLatestSpeeches() {
        try {
            const speeches = await this.fetchAPI('/speeches?limit=10');
            this.displaySpeeches(speeches);
        } catch (error) {
            console.error('Failed to load speeches:', error);
        }
    }

    async loadResources() {
        try {
            const category = document.getElementById('resourceCategory')?.value || 'all';
            const sort = document.getElementById('resourceSort')?.value || 'newest';
            
            const resources = await this.fetchAPI(`/resources?category=${category}&sort=${sort}`);
            this.displayResources(resources);
            
            // Update resource count
            document.getElementById('resourceCount').textContent = resources.length;
            document.getElementById('totalDownloads').textContent = 
                resources.reduce((sum, res) => sum + (res.download_count || 0), 0);
                
        } catch (error) {
            console.error('Failed to load resources:', error);
        }
    }

    async loadTimerState() {
        try {
            const state = await this.fetchAPI('/timer');
            this.currentTimerState = state;
            this.updateTimerDisplay();
        } catch (error) {
            console.error('Failed to load timer state:', error);
        }
    }

    // UI update methods
    updateTimeDisplay() {
        const now = new Date();
        
        // Format time
        const timeString = now.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        const dateString = now.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        
        document.getElementById('currentTime').textContent = timeString;
        document.getElementById('currentDate').textContent = dateString;
    }

    updateTimerDisplay() {
        if (!this.currentTimerState) return;
        
        const { remaining_time, is_running, current_speaker, total_time } = this.currentTimerState;
        
        // Format time as MM:SS
        const minutes = Math.floor(remaining_time / 60);
        const seconds = remaining_time % 60;
        const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        document.getElementById('timerDisplay').textContent = timeString;
        document.getElementById('timerStatus').textContent = 
            is_running ? 'Running' : 'Stopped';
        document.getElementById('displaySpeaker').textContent = 
            current_speaker || 'None';
        document.getElementById('totalTime').textContent = total_time;
        
        // Update status indicator color
        const statusIndicator = document.getElementById('timerStatus');
        statusIndicator.className = `status-indicator ${is_running ? 'running' : 'stopped'}`;
    }

    displaySpeeches(speeches) {
        const speechesList = document.getElementById('speechesList');
        
        if (!speeches || speeches.length === 0) {
            speechesList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-comment-slash"></i>
                    <p>No speeches yet. Be the first to speak!</p>
                </div>
            `;
            return;
        }
        
        speechesList.innerHTML = speeches.map(speech => `
            <div class="speech-card">
                <div class="speech-header">
                    <div class="speaker-info">
                        <i class="fas fa-user-circle"></i>
                        <div>
                            <strong>${speech.speaker}</strong>
                            <small>${new Date(speech.speech_time).toLocaleString()}</small>
                        </div>
                    </div>
                    <span class="speech-topic">${speech.debate_topic || 'General Debate'}</span>
                </div>
                <div class="speech-content">
                    ${speech.content}
                </div>
                <div class="speech-footer">
                    <span class="speech-duration">
                        <i class="fas fa-clock"></i> ${speech.duration || 60}s
                    </span>
                    <button class="btn-like" onclick="app.likeSpeech(${speech.id})">
                        <i class="fas fa-thumbs-up"></i> ${speech.likes || 0}
                    </button>
                </div>
            </div>
        `).join('');
    }

    displayResources(resources) {
        const resourcesList = document.getElementById('resourcesList');
        const modalResourcesList = document.getElementById('modalResourcesList');
        
        if (!resources || resources.length === 0) {
            const emptyState = `
                <div class="empty-state">
                    <i class="fas fa-folder-open"></i>
                    <p>No resources available yet. Upload the first one!</p>
                </div>
            `;
            
            if (resourcesList) resourcesList.innerHTML = emptyState;
            if (modalResourcesList) modalResourcesList.innerHTML = emptyState;
            return;
        }
        
        const resourceHTML = resources.map(resource => `
            <div class="resource-card">
                <div class="resource-icon">
                    <i class="${this.getFileIcon(resource.mimetype)}"></i>
                </div>
                <div class="resource-info">
                    <h4>${resource.originalname}</h4>
                    <p class="resource-description">${resource.description || 'No description'}</p>
                    <div class="resource-meta">
                        <span><i class="fas fa-user"></i> ${resource.uploader || 'Anonymous'}</span>
                        <span><i class="fas fa-calendar"></i> ${new Date(resource.upload_time).toLocaleDateString()}</span>
                        <span><i class="fas fa-download"></i> ${resource.download_count || 0}</span>
                        <span><i class="fas fa-thumbs-up"></i> ${resource.likes || 0}</span>
                    </div>
                    <div class="resource-actions">
                        <button class="btn btn-primary btn-sm" onclick="app.downloadResource('${resource.id}')">
                            <i class="fas fa-download"></i> Download
                        </button>
                        <span class="file-size">${this.formatFileSize(resource.size)}</span>
                    </div>
                </div>
            </div>
        `).join('');
        
        if (resourcesList) resourcesList.innerHTML = resourceHTML;
        if (modalResourcesList) modalResourcesList.innerHTML = resourceHTML;
    }

    addSpeechToUI(speech) {
        const speechesList = document.getElementById('speechesList');
        
        // Check if empty state is shown
        if (speechesList.querySelector('.empty-state')) {
            speechesList.innerHTML = '';
        }
        
        const speechHTML = `
            <div class="speech-card">
                <div class="speech-header">
                    <div class="speaker-info">
                        <i class="fas fa-user-circle"></i>
                        <div>
                            <strong>${speech.speaker}</strong>
                            <small>${new Date(speech.timestamp).toLocaleString()}</small>
                        </div>
                    </div>
                    <span class="speech-topic">${speech.debateTopic || 'General Debate'}</span>
                </div>
                <div class="speech-content">
                    ${speech.content}
                </div>
                <div class="speech-footer">
                    <span class="speech-duration">
                        <i class="fas fa-clock"></i> ${speech.duration || 60}s
                    </span>
                    <button class="btn-like" onclick="app.likeSpeech(${speech.id})">
                        <i class="fas fa-thumbs-up"></i> ${speech.likes || 0}
                    </button>
                </div>
            </div>
        `;
        
        // Add to top of list
        speechesList.insertAdjacentHTML('afterbegin', speechHTML);
        
        // Limit to 10 speeches
        const allSpeeches = speechesList.querySelectorAll('.speech-card');
        if (allSpeeches.length > 10) {
            allSpeeches[allSpeeches.length - 1].remove();
        }
    }

    // Action methods
    async submitSpeech() {
        if (!this.currentUser) {
            toastr.error('Please enter your name first');
            document.getElementById('speechSpeaker').focus();
            return;
        }
        
        const speaker = document.getElementById('speechSpeaker').value || this.currentUser;
        const content = document.getElementById('speechContent').value;
        const topic = document.getElementById('speechTopic').value;
        const duration = document.getElementById('speechDuration').value;
        
        if (!content.trim()) {
            toastr.error('Please enter speech content');
            document.getElementById('speechContent').focus();
            return;
        }
        
        try {
            await this.fetchAPI('/speeches', {
                method: 'POST',
                body: JSON.stringify({
                    speaker,
                    content,
                    debateTopic: topic,
                    duration: parseInt(duration)
                })
            });
            
            // Clear form
            document.getElementById('speechContent').value = '';
            toastr.success('Speech submitted successfully!');
            this.closeModal('speechModal');
            
        } catch (error) {
            console.error('Failed to submit speech:', error);
        }
    }

    async uploadResource() {
        const fileInput = document.getElementById('fileInput');
        const category = document.getElementById('uploadCategory').value;
        const description = document.getElementById('uploadDescription').value;
        const uploader = document.getElementById('uploaderName').value || this.currentUser || 'Anonymous';
        
        if (!fileInput.files.length) {
            toastr.error('Please select a file to upload');
            return;
        }
        
        // 检查 Supabase 客户端是否已初始化
        if (!this.supabase) {
            toastr.error('文件上传功能未初始化，请刷新页面重试');
            return;
        }

        const file = fileInput.files[0];
        
        // 检查文件大小（限制为100KB）
        const maxSize = 100 * 1024; // 100KB
        if (file.size > maxSize) {
            toastr.error(`文件大小超过限制（最大100KB），当前文件：${(file.size / (1024)).toFixed(2)}KB`);
            return;
        }

        try {
            // 1. 上传文件到 Supabase 存储
            const fileName = `public/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
            const { data: uploadData, error: uploadError } = await this.supabase.storage
                .from('user-uploads')
                .upload(fileName, file, {
                    contentType: file.type,
                    upsert: false
                });

            if (uploadError) {
                console.error('Supabase 上传错误:', uploadError);
                throw new Error(`文件上传失败: ${uploadError.message}`);
            }

            console.log('文件上传成功:', uploadData.path);
            
            // 2. 获取文件的公共 URL
            const { data: urlData } = this.supabase.storage
                .from('user-uploads')
                .getPublicUrl(fileName);
            
            const publicUrl = urlData.publicUrl;
            
            // 3. 发送资源信息到后端 API 保存到数据库
            const resourceData = {
                filename: fileName,
                originalname: file.name,
                mimetype: file.type,
                size: file.size,
                category,
                description,
                uploader,
                storage_path: uploadData.path,
                public_url: publicUrl
            };

            const response = await fetch('/api/resources', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(resourceData)
            });

            if (!response.ok) {
                // 如果保存失败，尝试删除已上传的文件
                try {
                    await this.supabase.storage
                        .from('user-uploads')
                        .remove([fileName]);
                } catch (deleteError) {
                    console.error('删除已上传文件失败:', deleteError);
                }
                
                throw new Error('资源信息保存失败');
            }

            const result = await response.json();

            // 4. 清空表单
            fileInput.value = '';
            document.getElementById('uploadDescription').value = '';
            document.getElementById('uploaderName').value = '';

            toastr.success('资源上传成功！');
            this.closeModal('resourcesModal');

            // 5. 重新加载资源列表
            await this.loadResources();

        } catch (error) {
            console.error('上传失败:', error);
            toastr.error(`上传失败: ${error.message}`);
        } catch (error) {
            console.error('Download failed:', error);
            toastr.error('Failed to download resource');
        }
    }

    async likeSpeech(speechId) {
        // This would require an API endpoint for liking speeches
        // For now, just show a message
        toastr.info('Like functionality coming soon!');
    }

    // Timer control methods
    async startTimer() {
        if (!this.currentTimerState) return;
        
        try {
            await this.fetchAPI('/timer', {
                method: 'POST',
                body: JSON.stringify({
                    ...this.currentTimerState,
                    is_running: true
                })
            });
            
            toastr.info('Timer started');
        } catch (error) {
            console.error('Failed to start timer:', error);
        }
    }

    async pauseTimer() {
        if (!this.currentTimerState) return;
        
        try {
            await this.fetchAPI('/timer', {
                method: 'POST',
                body: JSON.stringify({
                    ...this.currentTimerState,
                    is_running: false
                })
            });
            
            toastr.info('Timer paused');
        } catch (error) {
            console.error('Failed to pause timer:', error);
        }
    }

    async resetTimer() {
        try {
            await this.fetchAPI('/timer/reset', {
                method: 'POST',
                body: JSON.stringify({
                    total_time: parseInt(document.getElementById('timerMinutes').value) * 60
                })
            });
            
            toastr.info('Timer reset');
        } catch (error) {
            console.error('Failed to reset timer:', error);
        }
    }

    async updateTimerSettings() {
        const minutes = parseInt(document.getElementById('timerMinutes').value) || 5;
        const speaker = document.getElementById('currentSpeaker').value || '';
        
        try {
            await this.fetchAPI('/timer', {
                method: 'POST',
                body: JSON.stringify({
                    is_running: false,
                    remaining_time: minutes * 60,
                    total_time: minutes * 60,
                    current_speaker: speaker
                })
            });
            
            toastr.success('Timer settings updated');
        } catch (error) {
            console.error('Failed to update timer settings:', error);
        }
    }

    // Supabase 客户端初始化
    initSupabase() {
        try {
            // Supabase 配置
            const supabaseUrl = 'https://rmfwcjjgtemfhswomkoh.supabase.co';
            const supabaseKey = 'sb_publishable_8MZXHrhYYjs8ZnFqU1aA9g_-h4TRjJa';
            
            // 检查 Supabase 库是否已加载
            if (typeof supabase === 'undefined') {
                console.error('Supabase 库未加载，请检查 CDN 引入');
                toastr.error('文件上传功能初始化失败，请刷新页面重试');
                return;
            }
            
            // 创建 Supabase 客户端
            this.supabase = supabase.createClient(supabaseUrl, supabaseKey);
            console.log('Supabase 客户端初始化成功');
        } catch (error) {
            console.error('Supabase 初始化失败:', error);
            toastr.error('文件上传功能初始化失败');
        }
    }

    // Utility methods
    getFileIcon(mimetype) {
        if (!mimetype) return 'fas fa-file';
        
        if (mimetype.includes('image')) return 'fas fa-file-image';
        if (mimetype.includes('pdf')) return 'fas fa-file-pdf';
        if (mimetype.includes('word') || mimetype.includes('document')) return 'fas fa-file-word';
        if (mimetype.includes('excel') || mimetype.includes('spreadsheet')) return 'fas fa-file-excel';
        if (mimetype.includes('video')) return 'fas fa-file-video';
        if (mimetype.includes('audio')) return 'fas fa-file-audio';
        if (mimetype.includes('text') || mimetype.includes('code')) return 'fas fa-file-code';
        
        return 'fas fa-file';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    openModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'block';
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        }
    }

    // Event binding
    bindEvents() {
        // Modal close buttons
        document.querySelectorAll('.close').forEach(button => {
            button.addEventListener('click', () => {
                const modal = button.closest('.modal');
                if (modal) {
                    modal.style.display = 'none';
                }
            });
        });
        
        // Click outside modal to close
        window.addEventListener('click', (event) => {
            if (event.target.classList.contains('modal')) {
                event.target.style.display = 'none';
            }
        });
        
        // Navigation buttons
        document.getElementById('resourcesBtn')?.addEventListener('click', () => {
            this.openModal('resourcesModal');
        });
        
        document.getElementById('timerBtn')?.addEventListener('click', () => {
            // Scroll to timer section
            document.querySelector('.timer-section').scrollIntoView({ behavior: 'smooth' });
        });
        
        document.getElementById('statsBtn')?.addEventListener('click', () => {
            // Scroll to statistics section
            document.querySelector('.statistics-section').scrollIntoView({ behavior: 'smooth' });
        });
        
        // Auth buttons
        document.getElementById('loginBtn')?.addEventListener('click', () => {
            this.openModal('authModal');
        });
        
        document.getElementById('logoutBtn')?.addEventListener('click', () => {
            this.logout();
        });
        
        // Auth form submission
        document.getElementById('loginSubmit')?.addEventListener('click', () => {
            const username = document.getElementById('loginUsername').value;
            if (this.login(username)) {
                document.getElementById('loginUsername').value = '';
            }
        });
        
        document.getElementById('registerSubmit')?.addEventListener('click', () => {
            const username = document.getElementById('registerUsername').value;
            if (this.login(username)) {
                document.getElementById('registerUsername').value = '';
                document.getElementById('registerPassword').value = '';
                document.getElementById('registerConfirm').value = '';
            }
        });
        
        // Speech form
        document.getElementById('newSpeechBtn')?.addEventListener('click', () => {
            this.openModal('speechModal');
        });
        
        document.getElementById('submitSpeech')?.addEventListener('click', () => {
            this.submitSpeech();
        });
        
        // Resource upload
        document.getElementById('uploadResourceBtn')?.addEventListener('click', () => {
            this.openModal('resourcesModal');
        });
        
        document.getElementById('submitUpload')?.addEventListener('click', () => {
            this.uploadResource();
        });
        
        // File input click
        document.getElementById('uploadArea')?.addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });
        
        // Timer controls
        document.getElementById('timerStart')?.addEventListener('click', () => {
            this.startTimer();
        });
        
        document.getElementById('timerPause')?.addEventListener('click', () => {
            this.pauseTimer();
        });
        
        document.getElementById('timerReset')?.addEventListener('click', () => {
            this.resetTimer();
        });
        
        document.getElementById('timerSet')?.addEventListener('click', () => {
            this.updateTimerSettings();
        });
        
        document.getElementById('updateSpeaker')?.addEventListener('click', () => {
            this.updateTimerSettings();
        });
        
        // Resource filters
        document.getElementById('resourceCategory')?.addEventListener('change', () => {
            this.loadResources();
        });
        
        document.getElementById('resourceSort')?.addEventListener('change', () => {
            this.loadResources();
        });
        
        // Refresh stats
        document.getElementById('refreshStatsBtn')?.addEventListener('click', () => {
            this.loadStats();
            toastr.info('Statistics refreshed');
        });
        
        // Drag and drop for file upload
        const uploadArea = document.getElementById('uploadArea');
        if (uploadArea) {
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.classList.add('dragover');
            });
            
            uploadArea.addEventListener('dragleave', () => {
                uploadArea.classList.remove('dragover');
            });
            
            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.classList.remove('dragover');
                
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    document.getElementById('fileInput').files = files;
                    toastr.info(`File selected: ${files[0].name}`);
                }
            });
        }
        
        // Initialize chart
        this.initVisitsChart();
    }

    initVisitsChart() {
        const ctx = document.getElementById('visitsChart');
        if (!ctx) return;
        
        // Sample data for the chart
        const data = {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Daily Visits',
                data: [65, 59, 80, 81, 56, 55, 40],
                backgroundColor: 'rgba(67, 97, 238, 0.2)',
                borderColor: 'rgba(67, 97, 238, 1)',
                borderWidth: 2,
                tension: 0.4,
                fill: true
            }]
        };
        
        this.visitsChart = new Chart(ctx, {
            type: 'line',
            data: data,
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    title: {
                        display: true,
                        text: 'Weekly Traffic Pattern'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            drawBorder: false
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    }
}

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new GlobalDebateHub();
});

// Global helper functions
function formatTime(seconds) {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
}

function showNotification(message, type = 'info') {
    const types = {
        'success': { icon: 'check-circle', color: 'success' },
        'error': { icon: 'exclamation-triangle', color: 'danger' },
        'warning': { icon: 'exclamation-circle', color: 'warning' },
        'info': { icon: 'info-circle', color: 'primary' }
    };
    
    const config = types[type] || types.info;
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${config.color}`;
    notification.innerHTML = `
        <i class="fas fa-${config.icon}"></i>
        <span>${message}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    // Add to notification container
    let container = document.getElementById('notificationContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notificationContainer';
        container.className = 'notification-container';
        document.body.appendChild(container);
    }
    
    container.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}