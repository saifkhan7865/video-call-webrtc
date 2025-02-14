import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import './App.css';

const socket = io('http://localhost:3000');

function App() {
  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState([]);
  const [isRegistered, setIsRegistered] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [currentCallUser, setCurrentCallUser] = useState(null);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);

  // Keep a reference to local and screen streams
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);

  useEffect(() => {
    // Socket event: Update user list
    socket.on('users-update', (userList) => {
      setUsers(userList.filter((id) => id !== userId));
    });

    // Socket event: Incoming call
    socket.on('incoming-call', async ({ offer, callerUserId }) => {
      if (window.confirm(`Incoming call from ${callerUserId}. Accept?`)) {
        try {
          // Get local camera/mic
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
          localVideoRef.current.srcObject = stream;
          localStreamRef.current = stream;

          // Create peer connection with the caller as the 'targetUserId'
          const pc = createPeerConnection(callerUserId);
          setCurrentCallUser(callerUserId);

          // Add local tracks
          stream.getTracks().forEach((track) => pc.addTrack(track, stream));

          // Handle incoming offer
          await pc.setRemoteDescription(new RTCSessionDescription(offer));

          // Create & send answer
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          socket.emit('call-accepted', {
            targetUserId: callerUserId,
            answer,
          });

          setInCall(true);
        } catch (error) {
          console.error('Error accepting call:', error);
        }
      }
    });

    // Socket event: Call accepted
    socket.on('call-accepted', async ({ answer }) => {
      try {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.setRemoteDescription(
            new RTCSessionDescription(answer)
          );
        }
      } catch (error) {
        console.error('Error setting remote description:', error);
      }
    });

    // Socket event: ICE candidate
    socket.on('ice-candidate', async ({ candidate }) => {
      try {
        if (peerConnectionRef.current && candidate) {
          await peerConnectionRef.current.addIceCandidate(
            new RTCIceCandidate(candidate)
          );
        }
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    });

    // Socket event: Call ended
    socket.on('call-ended', () => {
      endCall();
    });

    return () => {
      socket.off('users-update');
      socket.off('incoming-call');
      socket.off('call-accepted');
      socket.off('ice-candidate');
      socket.off('call-ended');
    };
  }, [userId]);

  /**
   * Create a new RTCPeerConnection. We pass in targetUserId so we can
   * send ICE candidates immediately, without relying on currentCallUser.
   */
  const createPeerConnection = (targetUserId) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    // A fresh remote stream to hold inbound tracks
    const remoteStream = new MediaStream();

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && targetUserId) {
        socket.emit('ice-candidate', {
          targetUserId,
          candidate,
        });
      }
    };

    // Whenever we get a track, add it to the remoteStream
    pc.ontrack = (event) => {
      remoteStream.addTrack(event.track);
      remoteVideoRef.current.srcObject = remoteStream;
    };

    // Store it for use in answer/offers later
    peerConnectionRef.current = pc;
    return pc;
  };

  // Register the user
  const registerUser = (e) => {
    e.preventDefault();
    if (userId.trim()) {
      socket.emit('register', userId);
      setIsRegistered(true);
    }
  };

  // Initiate a call
  const startCall = async (targetUserId) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localVideoRef.current.srcObject = stream;
      localStreamRef.current = stream;

      // Create peer connection for the user we're calling
      const pc = createPeerConnection(targetUserId);
      setCurrentCallUser(targetUserId);

      // Add our local tracks
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Create and send an offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit('call-user', {
        targetUserId,
        offer,
        callerUserId: userId,
      });

      setInCall(true);
    } catch (error) {
      console.error('Error starting call:', error);
    }
  };

  // Toggle screen share on/off
  const toggleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        // Start screen capture
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });
        screenStreamRef.current = screenStream;

        const videoTrack = screenStream.getVideoTracks()[0];
        const sender = peerConnectionRef.current
          .getSenders()
          .find((s) => s.track?.kind === 'video');

        if (sender) {
          await sender.replaceTrack(videoTrack);
        }

        // If the user stops sharing via the browser UI, revert
        screenStream.getVideoTracks()[0].onended = () => {
          toggleScreenShare();
        };

        setIsScreenSharing(true);
      } else {
        // Stop screen sharing; go back to the webcam's video track
        const videoTrack = localStreamRef.current.getVideoTracks()[0];
        const sender = peerConnectionRef.current
          .getSenders()
          .find((s) => s.track?.kind === 'video');

        if (sender) {
          await sender.replaceTrack(videoTrack);
        }

        // Stop the screen tracks
        screenStreamRef.current?.getTracks().forEach((track) => track.stop());

        setIsScreenSharing(false);
      }
    } catch (error) {
      console.error('Error toggling screen share:', error);
    }
  };

  // End the call
  const endCall = () => {
    // Close the RTCPeerConnection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    // Stop local camera/mic
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }

    // Stop screen sharing if active
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
    }

    // Cleanup video elements
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    setInCall(false);
    setIsScreenSharing(false);
    setCurrentCallUser(null);
  };

  return (
    <div className="app">
      {!isRegistered ? (
        <form onSubmit={registerUser} className="register-form">
          <input
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Enter your name"
            required
          />
          <button type="submit">Register</button>
        </form>
      ) : (
        <div className="main-content">
          <div className="video-container">
            {/* Local Video */}
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="video local-video"
            />
            {/* Remote Video */}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="video remote-video"
            />
          </div>
          <div className="controls">
            {!inCall ? (
              <div className="user-list">
                <h3>Online Users</h3>
                {users.map((user) => (
                  <button key={user} onClick={() => startCall(user)}>
                    Call {user}
                  </button>
                ))}
              </div>
            ) : (
              <div className="call-controls">
                <button onClick={toggleScreenShare}>
                  {isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
                </button>
                <button
                  onClick={() => {
                    socket.emit('end-call', { targetUserId: currentCallUser });
                    endCall();
                  }}
                  className="end-call"
                >
                  End Call
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
