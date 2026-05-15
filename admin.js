// ⚡ Cấu hình URL server
const CHAT_BACKEND_URL =
  window.location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? 'http://localhost:3000'
    : 'https://portfolio-2-wesv.onrender.com';

const socket = io(CHAT_BACKEND_URL);

// WebRTC Configuration
const peerConnectionConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

let peerConnection;
let localStream;
let currentCallerId = null; // socket ID of the guest
let callSessionId = null;   // sessionId of the active call
let iceRestartTimer = null;
let isReconnecting = false;

// DOM Elements
const incomingCallsContainer = document.getElementById('incoming-calls');
const videoContainer = document.getElementById('video-container');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const endCallBtn = document.getElementById('end-call-btn');
const adminMuteBtn = document.getElementById('admin-mute-btn');
const adminVideoBtn = document.getElementById('admin-video-toggle-btn');
const adminFlipBtn = document.getElementById('admin-flip-btn');

// Mobile DOM Elements
const mMuteBtn = document.getElementById('m-admin-mute-btn');
const mVideoBtn = document.getElementById('m-admin-video-btn');
const mFlipBtn = document.getElementById('m-admin-flip-btn');
const mEndBtn = document.getElementById('m-admin-end-btn');

let currentFacingMode = 'user';
let isProcessingEndCall = false; // Tránh lặp thông báo kết thúc
let isAdminAuthenticated = false;
let cachedAdminPassword = null;

// --- SOCKET LOGIC ---
socket.on('connect', () => {
  console.log('Connected to server');

  if (isAdminAuthenticated && cachedAdminPassword) {
    // Reconnect sau khi đã xác thực: tự join lại mà không hỏi lại
    socket.emit('admin:join', { password: cachedAdminPassword });
    // Xử lý reconnect cuộc gọi sẽ nằm trong admin:auth_success handler
    return;
  }

  const password = prompt('Nhập mã OTP Admin (kiểm tra Telegram):');
  if (password) {
    cachedAdminPassword = password;
    socket.emit('admin:join', { password });
  }
});

socket.on('admin:auth_success', () => {
  console.log('Admin Authenticated');
  const wasAlreadyAuthenticated = isAdminAuthenticated;
  isAdminAuthenticated = true;

  // Nếu đang trong cuộc gọi (reconnect sau đổi mạng):
  if (currentCallerId && localStream && callSessionId) {
    // Luôn reset flag trước
    isReconnecting = false;

    const iceState = peerConnection?.iceConnectionState;
    const sigState = peerConnection?.signalingState;
    const isDead = !peerConnection || iceState === 'failed' || iceState === 'closed' || sigState === 'closed';

    console.log(`[WebRTC Admin] Reconnect: ICE=${iceState}, Sig=${sigState}, dead=${isDead}`);

    if (isDead) {
      // PeerConnection đã chết (tắt 4G lâu) → tạo mới hoàn toàn
      console.log('[WebRTC Admin] PeerConnection dead → full reconnect...');
      if (peerConnection) { try { peerConnection.close(); } catch(e) {} }
      setupAdminPeerConnection();
    }

    // Gửi lại call:accept → guest nhận adminId mới
    // Nếu PeerConnection vừa được tạo mới, guest sẽ gửi offer mới
    // Nếu PeerConnection còn sống, thử ICE restart sau 1.5s
    socket.emit('call:accept', { sessionId: callSessionId });

    if (!isDead) {
      setTimeout(() => {
        if (peerConnection && peerConnection.iceConnectionState !== 'connected'
            && peerConnection.iceConnectionState !== 'completed') {
          attemptAdminIceRestart();
        }
      }, 1500);
    }
    return;
  }

  // Chỉ hiện alert khi đăng nhập lần đầu (không phải reconnect)
  if (!wasAlreadyAuthenticated) {
    alert('Đăng nhập Admin thành công. Đang chờ cuộc gọi...');
  }
});

socket.on('chat error', (data) => {
  // Nếu OTP hết hạn trong lúc đang reconnect, reset và hỏi lại
  if (data.error.includes('OTP') || data.error.includes('mật khẩu')) {
    isAdminAuthenticated = false;
    cachedAdminPassword = null;
    alert('Lỗi: ' + data.error);
    const password = prompt('Nhập lại mã OTP Admin:');
    if (password) {
      cachedAdminPassword = password;
      socket.emit('admin:join', { password });
    }
  } else {
    alert('Lỗi: ' + data.error);
  }
});

socket.on('call:incoming', ({ sessionId, callerId }) => {
  console.log('Incoming call from:', sessionId, callerId);

  // Create UI for incoming call
  const callEl = document.createElement('div');
  callEl.className = 'call-item';
  callEl.id = `call-${callerId}`;
  callEl.innerHTML = `
    <div>
      <strong>Cuộc gọi đến từ:</strong> Khách (${sessionId})
    </div>
    <div style="display: flex; gap: 10px;">
      <button class="btn btn-accept" onclick="acceptCall('${sessionId}', '${callerId}')">Nhận</button>
      <button class="btn btn-reject" onclick="rejectCall('${sessionId}', '${callerId}')">Từ chối</button>
    </div>
  `;
  incomingCallsContainer.appendChild(callEl);
});

socket.on('call:ended', () => {
  endCall(true);
});

// Guest gửi Offer -> Admin xử lý và gửi lại Answer
socket.on('webrtc:signal', async ({ senderId, signal }) => {
  if (!peerConnection) return;

  // Cập nhật callerId nếu nhận signal từ peer mới (sau reconnect)
  if (senderId !== currentCallerId && currentCallerId) {
    console.log(`[WebRTC Admin] Cập nhật callerId: ${currentCallerId} → ${senderId}`);
    currentCallerId = senderId;
  }

  try {
    if (signal.type === 'offer') {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('webrtc:signal', {
        targetId: senderId,
        signal: peerConnection.localDescription,
      });
    } else if (signal.type === 'answer') {
      // Admin nhận answer (khi Admin là bên gửi offer, ví dụ ICE restart)
      await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
    } else if (signal.candidate) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(signal));
    }
  } catch (e) {
    console.error('[WebRTC Admin] Signal handling error:', e);
  }
});

/**
 * ICE restart cho Admin: tạo offer mới với iceRestart=true
 * Dùng khi chuyển mạng (WiFi→4G, on/off 4G...)
 */
async function attemptAdminIceRestart() {
  if (!peerConnection || peerConnection.signalingState === 'closed') {
    console.log('[WebRTC Admin] PeerConnection đã đóng, không thể ICE restart');
    isReconnecting = false;
    return;
  }

  // Nếu socket chưa kết nối, signal không gửi được → không lock flag
  if (!socket.connected) {
    console.log('[WebRTC Admin] Socket chưa kết nối, hoãn ICE restart...');
    return;
  }

  if (isReconnecting) {
    console.log('[WebRTC Admin] Đang trong quá trình reconnect, bỏ qua...');
    return;
  }

  isReconnecting = true;
  console.log('[WebRTC Admin] 🔄 Bắt đầu ICE restart...');

  try {
    const offer = await peerConnection.createOffer({ iceRestart: true });
    await peerConnection.setLocalDescription(offer);
    socket.emit('webrtc:signal', {
      targetId: currentCallerId,
      signal: peerConnection.localDescription,
    });
    console.log('[WebRTC Admin] ✅ ICE restart offer sent');
  } catch (e) {
    console.error('[WebRTC Admin] ICE restart failed:', e);
    isReconnecting = false;
  }
}

// --- MEDIA & CALL LOGIC ---
async function setupLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    updateControlButtons();

    // Đảm bảo micro được bật
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = true;
      console.log("Admin microphone activated");
    }
  } catch (err) {
    alert('Không thể truy cập Camera/Micro: ' + err.message);
    throw err;
  }
}

/**
 * Thiết lập PeerConnection cho Admin với đầy đủ event handlers.
 * Dùng khi accept call lần đầu và khi full reconnect sau mất mạng lâu.
 */
function setupAdminPeerConnection() {
  peerConnection = new RTCPeerConnection(peerConnectionConfig);

  // Add local stream tracks
  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  }

  // Handle incoming streams
  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  // Handle ICE candidates - dùng currentCallerId (không dùng closure variable)
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && currentCallerId) {
      socket.emit('webrtc:signal', {
        targetId: currentCallerId,
        signal: event.candidate
      });
    }
  };

  // ── ICE Connection Monitoring (Admin) ──
  peerConnection.oniceconnectionstatechange = () => {
    const state = peerConnection?.iceConnectionState;
    console.log(`[WebRTC Admin] ICE state: ${state}`);

    if (state === 'disconnected') {
      if (iceRestartTimer) clearTimeout(iceRestartTimer);
      iceRestartTimer = setTimeout(() => {
        attemptAdminIceRestart();
      }, 3000);
    } else if (state === 'failed') {
      attemptAdminIceRestart();
    } else if (state === 'connected' || state === 'completed') {
      if (iceRestartTimer) {
        clearTimeout(iceRestartTimer);
        iceRestartTimer = null;
      }
      isReconnecting = false;
    } else if (state === 'closed') {
      if (iceRestartTimer) clearTimeout(iceRestartTimer);
    }
  };

  return peerConnection;
}

window.acceptCall = async (sessionId, callerId) => {
  // Remove incoming call UI
  const callEl = document.getElementById(`call-${callerId}`);
  if (callEl) callEl.remove();

  try {
    await setupLocalStream();

    currentCallerId = callerId;
    callSessionId = sessionId;
    videoContainer.style.display = 'flex';
    endCallBtn.style.display = 'inline-block';

    // Mobile: kích hoạt chế độ full-screen
    document.body.classList.add('in-call');

    // Initialize WebRTC bằng helper function
    setupAdminPeerConnection();

    // Notify guest that we accepted, Guest will send an Offer
    socket.emit('call:accept', { sessionId });

    // Initial button states
    updateControlButtons();
  } catch (e) {
    console.error(e);
  }
};

function updateControlButtons() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  const videoTrack = localStream.getVideoTracks()[0];

  const isMuted = !audioTrack.enabled;
  const isVideoOff = !videoTrack.enabled;

  // Desktop buttons
  if (adminMuteBtn) {
    adminMuteBtn.classList.toggle('is-off', isMuted);
    adminMuteBtn.title = isMuted ? "Bật Mic" : "Tắt Mic";
  }
  if (adminVideoBtn) {
    adminVideoBtn.classList.toggle('is-off', isVideoOff);
    adminVideoBtn.title = isVideoOff ? "Bật Camera" : "Tắt Camera";
  }

  // Mobile buttons — sync trạng thái
  if (mMuteBtn) mMuteBtn.classList.toggle('is-off', isMuted);
  if (mVideoBtn) mVideoBtn.classList.toggle('is-off', isVideoOff);

  // Toggle placeholder
  let placeholder = document.getElementById('admin-video-placeholder');
  if (isVideoOff) {
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.id = 'admin-video-placeholder';
      placeholder.className = 'video-off-placeholder';
      placeholder.innerHTML = '<div style="font-size: 30px;">📷</div><div style="margin-top:8px; font-size:11px; color:#888;">Camera tắt</div>';
      localVideo.parentElement.appendChild(placeholder);
    }
  } else if (placeholder) {
    placeholder.remove();
  }
}


if (adminMuteBtn) {
  adminMuteBtn.addEventListener('click', () => {
    if (localStream) {
      const track = localStream.getAudioTracks()[0];
      track.enabled = !track.enabled;
      updateControlButtons();
    }
  });
}

if (adminVideoBtn) {
  adminVideoBtn.addEventListener('click', () => {
    if (localStream) {
      const track = localStream.getVideoTracks()[0];
      track.enabled = !track.enabled;
      updateControlButtons();
    }
  });
}

if (adminFlipBtn) {
  adminFlipBtn.addEventListener('click', async () => {
    if (!localStream || adminFlipBtn.disabled) return;

    adminFlipBtn.disabled = true;
    adminFlipBtn.style.opacity = '0.5';

    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

    try {
      const oldVideoTrack = localStream.getVideoTracks()[0];
      const audioTrack = localStream.getAudioTracks()[0];

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: currentFacingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      const newVideoTrack = newStream.getVideoTracks()[0];

      // Thay thế video track trong PeerConnection TRƯỚC khi stop track cũ
      if (peerConnection) {
        const videoSender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(newVideoTrack);
          console.log('Admin flip cam: replaceTrack thành công');
        }
      }

      // Stop track cũ SAU KHI đã replace xong
      if (oldVideoTrack) oldVideoTrack.stop();

      // Cập nhật localStream: xóa track cũ, thêm track mới
      if (oldVideoTrack) localStream.removeTrack(oldVideoTrack);
      localStream.addTrack(newVideoTrack);

      // Gán lại srcObject để hiển thị local preview
      localVideo.srcObject = localStream;

      updateControlButtons();
    } catch (err) {
      console.error("Lỗi xoay camera Admin:", err);
      currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    } finally {
      adminFlipBtn.disabled = false;
      adminFlipBtn.style.opacity = '1';
    }
  });
}




// Check cameras on load (No longer hiding button, logic removed)


window.rejectCall = (sessionId, callerId) => {
  const callEl = document.getElementById(`call-${callerId}`);
  if (callEl) callEl.remove();
  socket.emit('call:reject', { sessionId });
};

function endCall(showNotify = false) {
  if (isProcessingEndCall) return;
  isProcessingEndCall = true;

  if (iceRestartTimer) {
    clearTimeout(iceRestartTimer);
    iceRestartTimer = null;
  }
  isReconnecting = false;

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  if (currentCallerId) {
    socket.emit('call:end', { targetId: currentCallerId, sessionId: callSessionId });
    currentCallerId = null;
    callSessionId = null;
  }

  videoContainer.style.display = 'none';
  endCallBtn.style.display = 'none';
  remoteVideo.srcObject = null;
  localVideo.srcObject = null;

  document.body.classList.remove('in-call');

  if (showNotify) {
    alert('Cuộc gọi đã kết thúc.');
  }

  // Reset flag
  setTimeout(() => { isProcessingEndCall = false; }, 1000);
}

endCallBtn.addEventListener('click', endCall);

// === MOBILE CONTROLS ===
if (mMuteBtn) {
  mMuteBtn.addEventListener('click', () => {
    if (localStream) {
      const track = localStream.getAudioTracks()[0];
      track.enabled = !track.enabled;
      updateControlButtons();
    }
  });
}

if (mVideoBtn) {
  mVideoBtn.addEventListener('click', () => {
    if (localStream) {
      const track = localStream.getVideoTracks()[0];
      track.enabled = !track.enabled;
      updateControlButtons();
    }
  });
}

if (mFlipBtn) {
  mFlipBtn.addEventListener('click', async () => {
    if (!localStream || mFlipBtn.disabled) return;

    mFlipBtn.disabled = true;
    mFlipBtn.style.opacity = '0.5';

    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

    try {
      const oldVideoTrack = localStream.getVideoTracks()[0];

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: currentFacingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      const newVideoTrack = newStream.getVideoTracks()[0];

      if (peerConnection) {
        const videoSender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
        if (videoSender) {
          await videoSender.replaceTrack(newVideoTrack);
        }
      }

      if (oldVideoTrack) oldVideoTrack.stop();
      if (oldVideoTrack) localStream.removeTrack(oldVideoTrack);
      localStream.addTrack(newVideoTrack);
      localVideo.srcObject = localStream;

      updateControlButtons();
    } catch (err) {
      console.error("Lỗi xoay camera Admin (mobile):", err);
      currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    } finally {
      mFlipBtn.disabled = false;
      mFlipBtn.style.opacity = '1';
    }
  });
}

if (mEndBtn) {
  mEndBtn.addEventListener('click', endCall);
}
